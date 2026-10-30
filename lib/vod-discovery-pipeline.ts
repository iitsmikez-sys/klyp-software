/** Experimental full-VOD discovery. Never selected by production unless explicitly enabled. */
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ffmpegLocationArgs, resolveBin, run, runCapture } from './bin';
import { downloadAudio, extractAudio, findClips, findKeywordMatches, formatTranscript,
  transcribe, type PipelineResult, type PipelineProgress } from './analyze-pipeline';
import { detectChatSpikes, type AudioWindow, type ChatSpike } from './twitch-chat';
import { planCandidateWindows } from './vod-candidates';
import { scanAudioActivity } from './audio-scan';
import { scanSceneChanges } from './scene-activity';
import { ensureCachedAnalysisAudio } from './analysis-audio-cache';
import { missingCoverage, reusableWords, type CoverageSegment } from './transcript-coverage';
import { createTranscriptCache, ANALYSIS_CACHE_VERSION, ANALYSIS_SPEECH_MODEL, type TranscriptCache } from './transcript-cache';
import { createStageMeter } from './analysis-meter';
import { reviewProcessingBudget } from './vod-budget';
import { verifyVodDuration } from './vod-duration';
import { withSourceWorkLock } from './analysis-work-lock';
import { selectReviewedCachedClips, createResultCache, resultCacheKey } from './analysis-result-cache';
import { resolveSourceSegment } from './video-cache';
import { validateFinalistVisuals } from './vision-validation';
import { anthropicCreditGate } from './anthropic-credit';
import { DEFAULT_CONTENT_TYPE, clipSchemaForContentType, type ContentType, type TimedWord } from './clips';
import type { ClipCount } from './sparks';
import type { SupabaseClient } from '@supabase/supabase-js';

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
    '-c:a', 'aac', '-b:a', '96k', target], { stallTimeoutMs: 60_000, maxRunMs: 5 * 60_000 });
  return target;
}

async function selectedSceneSignals(url: string, windows: AudioWindow[], uploadedPath: string | null): Promise<{ seconds: number; strength: number }[]> {
  const events: { seconds: number; strength: number }[] = [];
  // A few low-resolution checks on already nominated footage. Missing scene data never blocks Opus.
  for (const window of windows.slice(0, 4)) {
    try {
      const source = uploadedPath ? { path: uploadedPath, offsetSeconds: 0 }
        : await resolveSourceSegment(url, window.start, window.end, 240, 40_000);
      events.push(...await scanSceneChanges(source.path, window.start - source.offsetSeconds,
        window.end - window.start, window.start));
    } catch (error) {
      console.warn('[discovery-v2] scene signal unavailable', error instanceof Error ? error.message : error);
    }
  }
  return events;
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

  let windows: AudioWindow[];
  let spikes: ChatSpike[] | null = null;
  if (vodSeconds < 2 * 3600 || opts.uploadedPath) {
    windows = [{ start: 0, end: vodSeconds }];
  } else {
    const chatDone = meter.start('chat-scan');
    spikes = await (opts.chatSpikesPromise ?? detectChatSpikes(opts.url, vodSeconds, true).catch(() => null));
    chatDone({ windows: spikes?.length ?? 0 });
    const scanDone = meter.start('audio-scan');
    let audio;
    try { audio = await scanAudioActivity(cachedAudio.path); }
    catch (error) {
      console.warn('[discovery-v2] audio scan unavailable; preserving full-VOD coverage', error);
      audio = null;
    }
    scanDone({ windows: audio?.length ?? 0 });
    if (!audio) windows = [{ start: 0, end: vodSeconds }];
    else {
      const initial = planCandidateWindows(vodSeconds, spikes ?? [], audio, []);
      const sceneDone = meter.start('scene-scan');
      const scenes = await selectedSceneSignals(opts.url, initial.windows, opts.uploadedPath);
      sceneDone({ windows: scenes.length });
      const plan = planCandidateWindows(vodSeconds, spikes ?? [], audio, scenes);
      if (!plan.hourlyCoverage.every(Boolean)) throw new Error('Candidate plan left part of the VOD uncovered');
      windows = plan.windows;
    }
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
    const selectionCount: ClipCount = opts.clipCount === 20 ? 20 : opts.clipCount === 12 ? 12 : 10;
    const selected = await findClips(transcriptText, vodSeconds, spikes, selectionCount,
      contentType, opts.keyword, keywordMatches, [], opts.creatorPreferences ?? '', runId, windows);
    judged = selected.clips;
    skipped = selected.skipped;
    await resultCache.save(judged);
  }
  const schema = clipSchemaForContentType(contentType);
  const validated = judged.map(item => schema.safeParse(item));
  if (validated.some(item => !item.success)) throw new Error('Cached clip candidates failed validation');
  const initialReview = selectReviewedCachedClips(validated.map(item => item.data!), words, vodSeconds,
    opts.priorWindows ?? [], opts.clipCount, windows);
  let clips = initialReview.clips;
  const boundaryFlags = [...initialReview.flagged];
  // A repeat can consume the remainder of the first judged batch for free. Once
  // exhausted, ask Opus for a distinct batch from the already transcribed footage.
  if (!clips.length && initialReview.readyCount > 0 && (opts.priorWindows?.length ?? 0) > 0) {
    const nextKey = resultCacheKey({ sourceKey: opts.sourceKey, durationSeconds: vodSeconds,
      contentType, keyword: opts.keyword ?? '', creatorPreferences: opts.creatorPreferences ?? '',
      windows, priorWindows: opts.priorWindows });
    const nextCache = createResultCache(opts.client, opts.userId, opts.sourceKey, vodSeconds, nextKey);
    let nextJudged = await nextCache.load();
    if (nextJudged === null) {
      const next = await findClips(transcriptText, vodSeconds, spikes, opts.clipCount,
        contentType, opts.keyword, keywordMatches, opts.priorWindows,
        opts.creatorPreferences ?? '', runId, windows);
      nextJudged = next.clips;
      skipped += next.skipped;
      await nextCache.save(nextJudged);
    }
    const nextValidated = nextJudged.map(item => schema.safeParse(item));
    if (nextValidated.some(item => !item.success)) throw new Error('Cached repeat candidates failed validation');
    const nextReview = selectReviewedCachedClips(nextValidated.map(item => item.data!), words, vodSeconds,
      opts.priorWindows ?? [], opts.clipCount, windows);
    clips = nextReview.clips;
    boundaryFlags.push(...nextReview.flagged);
  }
  for (const item of boundaryFlags) {
    console.warn(`[discovery] clip ${item.clip.start_seconds}-${item.clip.end_seconds} needs boundary review: ${item.flags.join(', ')}`);
  }
  selectionDone({ windows: windows.length, cacheHit: resultHit });
  const visualDone = meter.start('visual-check');
  const checked = await validateFinalistVisuals(clips, opts.uploadedPath ?? opts.url,
    opts.workDir, !!opts.uploadedPath, runId);
  visualDone({ windows: Math.min(2, clips.length) });
  const result = { clips: checked.map(clip => ({ ...clip, words: words.filter(word =>
    word.start >= clip.start_seconds * 1000 - 200 && word.start < clip.end_seconds * 1000) })),
    skipped, durationSeconds: vodSeconds, transcriptChars: transcriptText.length, words, boundaryReview: boundaryFlags };
  await opts.onAnalysis?.(result);
  progress('analyze', 'done');
  return result;
}

export function runDiscoveryPipeline(opts: DiscoveryOptions): Promise<PipelineResult> {
  return withSourceWorkLock(opts.userId + ":" + opts.sourceKey, () => runDiscoveryPipelineUnlocked(opts));
}
