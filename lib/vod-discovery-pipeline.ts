/** Experimental full-VOD discovery. Never selected by production unless explicitly enabled. */
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveBin, run, runCapture } from './bin';
import { downloadAudio, extractAudio, findClips, findKeywordMatches, formatTranscript,
  transcribe, type PipelineResult, type PipelineProgress } from './analyze-pipeline';
import { detectChatSpikes, type AudioWindow, type ChatSpike } from './twitch-chat';
import { clipInsideObservedCoverage } from './vod-candidates';
import { ensureCachedAnalysisAudio } from './analysis-audio-cache';
import { missingCoverage, reusableWords, type CoverageSegment } from './transcript-coverage';
import { createTranscriptCache, ANALYSIS_CACHE_VERSION, ANALYSIS_SPEECH_MODEL, type TranscriptCache } from './transcript-cache';
import { createStageMeter } from './analysis-meter';
import { reviewProcessingBudget } from './vod-budget';
import { verifyVodDuration } from './vod-duration';
import { withSourceWorkLock } from './analysis-work-lock';
import { availableCachedClips, createResultCache, resultCacheKey } from './analysis-result-cache';
import { reviewClipBatch } from './clip-boundaries';
import { validateFinalistVisuals } from './vision-validation';
import { anthropicCreditGate } from './anthropic-credit';
import { DEFAULT_CONTENT_TYPE, clipSchemaForContentType, type ContentType, type TimedWord } from './clips';
import type { ClipCount } from './sparks';
import type { SupabaseClient } from '@supabase/supabase-js';
import { discoveryPoolSize, fullVodCoverage } from './discovery-pool';

export type DiscoveryOptions = {
  uploadedPath: string | null;
  url: string;
  sourceKey: string;
  userId: string;
  client: SupabaseClient;
  durationHint: number;
  clipCount: ClipCount;
  workDir: string;
  contentType?: ContentType;
  keyword?: string;
  priorWindows?: { start_seconds: number; end_seconds: number }[];
  creatorPreferences?: string;
  chatSpikesPromise?: Promise<ChatSpike[] | null> | null;
  costRunId?: string;
  onProgress?: PipelineProgress;
  onAnalysis?: (result: PipelineResult) => Promise<void>;
};

async function probeSeconds(file: string): Promise<number> {
  const result = await runCapture(resolveBin('ffprobe'), ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', file], { maxRunMs: 20_000 });
  const seconds = Number(result.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('Could not measure VOD audio duration');
  return seconds;
}

async function localAudioWindow(source: string, window: AudioWindow, workDir: string): Promise<string> {
  const target = path.join(workDir, `v2-${window.start}-${window.end}.m4a`);
  await run(resolveBin('ffmpeg'), ['-y', '-ss', String(window.start), '-i', source,
    '-t', String(window.end - window.start), '-vn', '-ac', '1', '-ar', '16000',
    '-c:a', 'aac', '-b:a', '96k', target], { stallTimeoutMs: 60_000, maxRunMs: 30 * 60_000 });
  return target;
}

/** Existing Sparks accounting remains in the caller; this function only finds clips. */
async function runDiscoveryPipelineUnlocked(opts: DiscoveryOptions): Promise<PipelineResult> {
  anthropicCreditGate.assertAvailable();
  const runId = opts.costRunId ?? randomUUID();
  const meter = createStageMeter(runId);
  const progress = opts.onProgress ?? (() => {});
  const finishDownload = meter.start('download');
  progress('download', 'running');
  let sourceBytesDownloaded = 0;
  const cachedAudio = await ensureCachedAnalysisAudio({
    userId: opts.userId, sourceKey: opts.sourceKey, durationSeconds: opts.durationHint,
    create: async target => {
      const source = opts.uploadedPath
        ? await extractAudio(opts.uploadedPath, opts.workDir)
        : await downloadAudio(opts.url, opts.workDir, true);
      sourceBytesDownloaded = (await stat(source)).size;
      await run(resolveBin('ffmpeg'), ['-y', '-i', source, '-vn', '-ac', '1', '-ar', '16000',
        '-c:a', 'aac', '-b:a', '96k', '-f', 'ipod', target],
      { stallTimeoutMs: 60_000, maxRunMs: 30 * 60_000 });
    },
  });
  const vodSeconds = verifyVodDuration(opts.durationHint, await probeSeconds(cachedAudio.path));
  finishDownload({ cacheHit: cachedAudio.cacheHit, bytesDownloaded: sourceBytesDownloaded,
    bytesWritten: cachedAudio.cacheHit ? 0 : (await stat(cachedAudio.path)).size });
  progress('download', 'done');

  const windows: AudioWindow[] = fullVodCoverage(vodSeconds);
  let spikes: ChatSpike[] | null = null;
  if (vodSeconds >= 2 * 3600 && !opts.uploadedPath) {
    const chatDone = meter.start('chat-scan');
    spikes = await (opts.chatSpikesPromise ?? detectChatSpikes(opts.url, vodSeconds, true).catch(() => null));
    chatDone({ windows: spikes?.length ?? 0 });
  }
  const cache = createTranscriptCache(opts.client, opts.userId, opts.sourceKey, vodSeconds);
  const cacheDone = meter.start('cache');
  const stored = await cache.load();
  const missing = missingCoverage(windows, stored);
  const ceiling = Number(process.env.KLYP_MAX_VOD_ESTIMATED_USD ?? 5);
  const budget = reviewProcessingBudget(missing, ceiling);
  console.log(`[analysis-budget] ${JSON.stringify({ runId, ...budget, ceilingUsd: ceiling, candidateWindows: windows.length, missingWindows: missing.length })}`);
  if (budget.requiresReview) {
    throw new Error(`This VOD needs an estimated $${budget.projectedUsd.toFixed(2)} processing budget, above the $${ceiling.toFixed(2)} limit. No candidate windows were dropped; review the budget before continuing.`);
  }
  cacheDone({ windows: windows.length - missing.length, audioSeconds: windows.reduce((sum, w) => sum + w.end - w.start, 0) -
    missing.reduce((sum, w) => sum + w.end - w.start, 0) });
  progress('transcribe', 'running');
  const transcriptionDone = meter.start('transcribe');
  const created: CoverageSegment[] = [];
  for (let index = 0; index < missing.length; index += 3) {
    await Promise.all(missing.slice(index, index + 3).map(async window => {
    const audioPath = await localAudioWindow(cachedAudio.path, window, opts.workDir);
    const measured = await probeSeconds(audioPath);
    if (Math.abs(measured - (window.end - window.start)) > 2) {
      throw new Error(`Audio window ${window.start}-${window.end} did not match the VOD timestamps; refusing partial cache`);
    }
    let localWords: TimedWord[];
    try { localWords = (await transcribe(audioPath, runId)).words; }
    catch (error) {
      if (!(error instanceof Error) || !error.message.includes('Transcription returned no words')) throw error;
      localWords = [];
    }
    const segment: CoverageSegment = {
      ...window, actualAudioSeconds: measured, vodSeconds, version: ANALYSIS_CACHE_VERSION,
      model: ANALYSIS_SPEECH_MODEL,
      words: localWords.map(word => ({ ...word, start: word.start + window.start * 1000,
        end: word.end + window.start * 1000 })),
    };
    await cache.save(segment);
    created.push(segment);
    }));
  }
  transcriptionDone({ windows: missing.length, audioSeconds: missing.reduce((sum, w) => sum + w.end - w.start, 0) });
  progress('transcribe', 'done');
  const words = reusableWords([...stored, ...created], windows);
  if (!words.length) throw new Error('No speech found in the selected footage; no clips were charged.');
  const transcriptText = formatTranscript(words);
  const keywordMatches = opts.keyword ? findKeywordMatches(words, opts.keyword) : [];
  progress('analyze', 'running');
  const selectionDone = meter.start('select');
  const contentType = opts.contentType ?? DEFAULT_CONTENT_TYPE;
  const cacheKey = resultCacheKey({ sourceKey: opts.sourceKey, durationSeconds: vodSeconds,
    contentType, keyword: opts.keyword ?? '', creatorPreferences: opts.creatorPreferences ?? '', windows });
  const resultCache = createResultCache(opts.client, opts.userId, opts.sourceKey, vodSeconds, cacheKey);
  let judged = await resultCache.load();
  let skipped = 0;
  const resultHit = judged !== null;
  if (judged === null) {
    const selectionCount = discoveryPoolSize(opts.clipCount);
    const selected = await findClips(transcriptText, vodSeconds, spikes, selectionCount,
      contentType, opts.keyword, keywordMatches, [], opts.creatorPreferences ?? '', runId, windows);
    judged = selected.clips;
    skipped = selected.skipped;
    await resultCache.save(judged);
  }
  const schema = clipSchemaForContentType(contentType);
  const validated = judged.map(item => schema.safeParse(item));
  if (validated.some(item => !item.success)) throw new Error('Cached clip candidates failed validation');
  selectionDone({ windows: windows.length, cacheHit: resultHit });
  const visualDone = meter.start('visual-check');
  const visualCache = createResultCache(opts.client, opts.userId, opts.sourceKey, vodSeconds,
    resultCacheKey({ sourceKey: opts.sourceKey, durationSeconds: vodSeconds, contentType,
      keyword: opts.keyword ?? '', creatorPreferences: opts.creatorPreferences ?? '',
      windows, pipeline: 'v2-visual' }));
  let readyPool = await visualCache.load();
  const boundaryFlags: ReturnType<typeof reviewClipBatch<(typeof judged)[number]>>['flagged'] = [];
  if (readyPool === null) {
    const review = reviewClipBatch(validated.map(item => item.data!), words, vodSeconds);
    boundaryFlags.push(...review.flagged);
    readyPool = await validateFinalistVisuals(review.ready.filter(clip => clipInsideObservedCoverage(clip, windows)), opts.uploadedPath ?? opts.url,
      opts.workDir, !!opts.uploadedPath, runId);
    await visualCache.save(readyPool);
  }
  let clips = availableCachedClips(readyPool, opts.priorWindows ?? [], opts.clipCount, windows);
  // A repeat can consume the remainder of the first judged batch for free. Once
  // exhausted, ask Opus for a distinct batch from the already transcribed footage.
  if (!clips.length && readyPool.length > 0 && (opts.priorWindows?.length ?? 0) > 0) {
    const nextKey = resultCacheKey({ sourceKey: opts.sourceKey, durationSeconds: vodSeconds,
      contentType, keyword: opts.keyword ?? '', creatorPreferences: opts.creatorPreferences ?? '',
      windows, priorWindows: opts.priorWindows });
    const nextCache = createResultCache(opts.client, opts.userId, opts.sourceKey, vodSeconds, nextKey);
    let nextJudged = await nextCache.load();
    if (nextJudged === null) {
      const next = await findClips(transcriptText, vodSeconds, spikes, discoveryPoolSize(opts.clipCount),
        contentType, opts.keyword, keywordMatches, opts.priorWindows,
        opts.creatorPreferences ?? '', runId, windows);
      nextJudged = next.clips;
      skipped += next.skipped;
      await nextCache.save(nextJudged);
    }
    const nextValidated = nextJudged.map(item => schema.safeParse(item));
    if (nextValidated.some(item => !item.success)) throw new Error('Cached repeat candidates failed validation');
    const nextVisualCache = createResultCache(opts.client, opts.userId, opts.sourceKey, vodSeconds,
      resultCacheKey({ sourceKey: opts.sourceKey, durationSeconds: vodSeconds, contentType,
        keyword: opts.keyword ?? '', creatorPreferences: opts.creatorPreferences ?? '',
        windows, priorWindows: opts.priorWindows, pipeline: 'v2-visual' }));
    let nextReady = await nextVisualCache.load();
    if (nextReady === null) {
      const nextReview = reviewClipBatch(nextValidated.map(item => item.data!), words, vodSeconds);
      boundaryFlags.push(...nextReview.flagged);
      nextReady = await validateFinalistVisuals(nextReview.ready.filter(clip => clipInsideObservedCoverage(clip, windows)), opts.uploadedPath ?? opts.url,
        opts.workDir, !!opts.uploadedPath, runId);
      await nextVisualCache.save(nextReady);
    }
    clips = availableCachedClips(nextReady, opts.priorWindows ?? [], opts.clipCount, windows);
  }
  for (const item of boundaryFlags) {
    console.warn(`[discovery] clip ${item.clip.start_seconds}-${item.clip.end_seconds} needs boundary review: ${item.flags.join(', ')}`);
  }
  visualDone({ windows: Math.min(2, clips.length) });
  const result = { clips: clips.map(clip => ({ ...clip, words: words.filter(word =>
    word.start >= clip.start_seconds * 1000 - 200 && word.start < clip.end_seconds * 1000) })),
    skipped, durationSeconds: vodSeconds, transcriptChars: transcriptText.length, words, boundaryReview: boundaryFlags };
  await opts.onAnalysis?.(result);
  progress('analyze', 'done');
  return result;
}

export function runDiscoveryPipeline(opts: DiscoveryOptions): Promise<PipelineResult> {
  return withSourceWorkLock(opts.userId + ":" + opts.sourceKey, () => runDiscoveryPipelineUnlocked(opts));
}
