/**
 * Core VOD analysis pipeline (download/extract → transcribe → find clips) —
 * shared between the interactive SSE route (app/api/analyze/route.ts) and the
 * auto-clip background worker (lib/vod-poll.ts), which has no browser
 * listening for progress events and no per-request user Bearer token.
 *
 * Auth, Sparks charging, SSE streaming, and Supabase persistence are each
 * caller's responsibility — this module only runs the actual pipeline.
 */
import { readdir, readFile } from "fs/promises";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { isMostlyEnglish, languageSection } from "@/lib/language-hint";
import { detectLoudMoments, formatLoudMomentsForPrompt, isQuietStream, readLoudSamples, type LoudMoment } from "@/lib/loud-moments";
import { bestWindowStart } from "@/lib/best-window";
import { logAnthropicRateLimits } from "@/lib/anthropic-rate-limits";
import { AssemblyAI } from "assemblyai";
import {
  clipAnalysisSchemaForContentType,
  clipSchemaForContentType,
  CLIP_TYPES_BY_CONTENT,
  DEFAULT_CONTENT_TYPE,
  type Clip,
  type AnalyzeStage,
  type ContentType,
  type TimedWord,
} from "@/lib/clips";
import { ffmpegLocationArgs, resolveBin, run, runCapture, runYtDlpWithRetry, ytDlpThreadCapArgs, FFMPEG_THREADS } from "@/lib/bin";
import {
  type ChatSpike,
  type AudioWindow,
  formatSpikesForPrompt,
  detectChatSpikes,
  twitchVideoId,
  spikeWindows,
} from "@/lib/twitch-chat";
import { type ClipCount } from "@/lib/sparks";
import { validateFinalistVisuals } from "@/lib/vision-validation";
import { anthropicCreditGate } from "@/lib/anthropic-credit";
import { recordProviderUsage } from "@/lib/provider-cost";
import { clipInsideObservedCoverage } from "@/lib/vod-candidates";
import { reviewClipBatch, type FlaggedClip } from "@/lib/clip-boundaries";
import { trimClipBatch } from "@/lib/clip-cut-snap";
import { formatTranscript } from "@/lib/format-transcript";
import { discoveryPoolSize } from "@/lib/discovery-pool";
import { availableCachedClips, createResultCache, resultCacheKey } from "@/lib/analysis-result-cache";
import { reviewProcessingBudget, runLimitForSeconds } from "@/lib/vod-budget";
import { budgetForRun } from "@/lib/provider-budget";
import { quoteSelectMessage, quoteTranscription } from "@/lib/provider-budget-core";
import { pickExtras, salvageClipsJson } from "@/lib/clip-extras";
import type { SupabaseClient } from "@supabase/supabase-js";
export { formatTranscript } from "@/lib/format-transcript";

/* ── Stage 2: download audio with yt-dlp ── */
export async function downloadAudio(url: string, dir: string, largeVod = false): Promise<string> {
  // Audio_Only on Twitch / bestaudio elsewhere — all HLS (m3u8) streams need
  // ffmpeg to merge segments. --ffmpeg-location avoids the stale-PATH hang.
  // Retries once on YouTube's transient 403/429 throttling (see runYtDlpWithRetry).
  // --socket-timeout makes yt-dlp bail on a dead connection instead of blocking
  // forever; stallTimeoutMs/maxRunMs kill the process if it wedges anyway.
  await runYtDlpWithRetry(
    [
      "-f", "bestaudio/best",
      "--no-playlist",
      "--max-filesize", largeVod ? "2G" : "500M",
      "--socket-timeout", "30",
      "--retries", "3",
      "--fragment-retries", "5",
      ...ffmpegLocationArgs(),
      ...ytDlpThreadCapArgs(),
      "--concurrent-fragments", "4",
      "-o", path.join(dir, "audio.%(ext)s"),
      url,
    ],
    { stallTimeoutMs: 60_000, maxRunMs: largeVod ? 30 * 60_000 : 10 * 60_000 }
  );

  const files = await readdir(dir);
  const audioFile = files.find((f) => f.startsWith("audio."));
  if (!audioFile) throw new Error("yt-dlp finished but no audio file was produced.");
  return path.join(dir, audioFile);
}

/** Keep `seconds` of an audio file starting at `start` (a straight copy, no re-encoding). */
async function trimAudioToPart(audioPath: string, dir: string, start: number, seconds: number): Promise<string> {
  const ext = path.extname(audioPath) || ".m4a";
  const outPath = path.join(dir, `part${ext}`);
  await run(resolveBin("ffmpeg"), ["-y", "-ss", String(start), "-i", audioPath, "-t", String(seconds), "-vn", "-c", "copy", outPath],
    { stallTimeoutMs: 60_000, maxRunMs: 10 * 60_000 });
  return outPath;
}

/* ── Stage 2 (upload flow): extract audio from an uploaded file with FFmpeg ── */
export async function extractAudio(sourcePath: string, dir: string): Promise<string> {
  const outPath = path.join(dir, "audio.m4a");
  await run(
    resolveBin("ffmpeg"),
    [
      "-i", sourcePath,
      "-vn",
      "-c:a", "aac",
      "-b:a", "96k",
      "-threads", String(FFMPEG_THREADS),
      "-y",
      outPath,
    ],
    // ffmpeg prints progress to stderr continuously — silence means it's wedged.
    { stallTimeoutMs: 30_000, maxRunMs: 10 * 60_000 }
  );
  return outPath;
}

/* The former chat-spike-only segment path is retained below for old helpers,
 * but disabled in runAnalysisPipeline. It omitted quiet entertaining moments.
 * Full-VOD processing now has a budget check before any download or paid call. */

/** Below this length, full audio is quick enough that segmenting isn't worth
 *  trading transcript coverage for. */
const SEGMENT_MIN_VOD_S = 2 * 3600;
/** Parallel segment downloads / transcriptions. */
const SEGMENT_CONCURRENCY = 3;

/** Download the audio for one window. Exact range, no padding — see the note
 *  on resolveSourceSegment in lib/video-cache.ts for why padding is a trap. */
async function downloadAudioWindow(url: string, dir: string, w: AudioWindow): Promise<string> {
  const stem = `win-${w.start}-${w.end}`;
  await runYtDlpWithRetry(
    [
      "-f", "bestaudio/best",
      "--no-playlist",
      "--socket-timeout", "30",
      "--retries", "3",
      "--fragment-retries", "5",
      ...ffmpegLocationArgs(),
      ...ytDlpThreadCapArgs(),
      "--download-sections", `*${w.start}-${w.end}`,
      "--force-keyframes-at-cuts",
      "--concurrent-fragments", "4",
      "-o", path.join(dir, `${stem}.%(ext)s`),
      url,
    ],
    { stallTimeoutMs: 60_000, maxRunMs: 5 * 60_000 }
  );
  const produced = (await readdir(dir)).find((f) => f.startsWith(`${stem}.`));
  if (!produced) throw new Error(`Segment ${w.start}-${w.end}s produced no audio file.`);
  return path.join(dir, produced);
}

/** Run tasks with bounded parallelism, preserving input order in the results. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * Transcribe each window and shift its word timestamps into the VOD's absolute
 * timeline. Without the shift every clip would point at the wrong moment,
 * since each segment's transcript starts at zero.
 */
async function transcribeWindows(paths: string[], windows: AudioWindow[], costRunId?: string): Promise<TimedWord[]> {
  const perWindow = await mapWithConcurrency(paths, SEGMENT_CONCURRENCY, async (audioPath, i) => {
    const offsetMs = windows[i].start * 1000;
    try {
      const { words } = await transcribe(audioPath, costRunId);
      return words.map((w) => ({ ...w, start: w.start + offsetMs, end: w.end + offsetMs }));
    } catch (err) {
      if (/provider budget|cannot be bounded|durable job ID|bounded price/i.test(String(err))) throw err;
      // A silent window (transcribe throws on zero words) must not sink the
      // whole analysis — the other windows still carry the good moments.
      console.warn(`[analyze] window ${windows[i].start}-${windows[i].end}s produced no transcript:`, err);
      return [] as TimedWord[];
    }
  });
  return perWindow.flat().sort((a, b) => a.start - b.start);
}

/* ── Stage 3: transcribe with AssemblyAI ── */
/** Up to this long a full pass always fits the standard $3 run budget, so no lookup is needed. */
const STANDARD_BUDGET_SAFE_SECONDS = 4 * 3600;

/**
 * Groq's Whisper is about a fifth of the price. It never stands in the way of an analysis: if it fails, is rate-limited
 * for too long, or hears no speech at all, the same audio goes to AssemblyAI exactly as before.
 */
async function transcribeWithGroq(audioPath: string, measured: number, costRunId?: string): Promise<{ words: TimedWord[]; durationSeconds: number } | null> {
  try {
    const { groqTranscribe, GROQ_MODEL } = await import("@/lib/groq-transcribe");
    const dir = path.dirname(audioPath);
    const result = await groqTranscribe(measured, {
      apiKey: process.env.GROQ_API_KEY!,
      makeChunk: (start, length, target) => run(resolveBin("ffmpeg"), ["-y", "-ss", String(start), "-t", String(length), "-i", audioPath,
        "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "48k", target], { stallTimeoutMs: 60_000, maxRunMs: 10 * 60_000 }).then(() => undefined),
      readFile: (file) => readFile(file),
      removeFile: (file) => import("fs/promises").then((fs) => fs.rm(file, { force: true })),
      tempPath: (name) => path.join(dir, `${costRunId ?? "run"}-${name}`),
    });
    if (costRunId) recordProviderUsage({ runId: costRunId, stage: "transcribe", provider: "groq", model: GROQ_MODEL, audioSeconds: measured });
    if (result.words.length === 0) {
      console.log("[transcribe] Groq heard no speech; asking AssemblyAI to be sure");
      return null;
    }
    console.log(`[transcribe] Groq: ${result.words.length} words in ${Math.round(measured / 60)} min${result.language ? ` (${result.language})` : ""}`);
    return { words: result.words, durationSeconds: Math.round(measured) };
  } catch (error) {
    console.log(`[transcribe] Groq failed, using AssemblyAI: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}

export async function transcribe(
  audioPath: string, costRunId?: string, fullPass = false, transcriber: "assemblyai" | "groq" = "assemblyai",
): Promise<{ words: TimedWord[]; durationSeconds: number }> {
  const aai = new AssemblyAI({ apiKey: process.env.ASSEMBLYAI_API_KEY! });

  // Probe the exact submitted file, then reserve before the SDK uploads it.
  const measured = Number((await runCapture(resolveBin('ffprobe'), ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', audioPath], { maxRunMs: 20_000 })).trim());
  if (transcriber === "groq" && process.env.GROQ_API_KEY && Number.isFinite(measured) && measured > 0) {
    const viaGroq = await transcribeWithGroq(audioPath, measured, costRunId);
    if (viaGroq) return viaGroq;
  }
  // Only ONE full-transcript pass over a long video is given the larger run budget (fixed by this
  // first reservation); sampled windows and everything up to about 6 hours keep the standard $3.
  const runLimit = fullPass && measured > STANDARD_BUDGET_SAFE_SECONDS ? runLimitForSeconds(measured) ?? undefined : undefined;
  const transcript = await budgetForRun(costRunId, runLimit).call('transcribe', quoteTranscription(measured),
    () => aai.transcripts.transcribe({ audio: audioPath, speech_models: ['universal-3-5-pro', 'universal-2'] }));

  if (transcript.status === "error") {
    // A file with no spoken audio (silence, music only) cannot be clipped: say so plainly. Nothing is charged for it.
    if (/no spoken audio|no speech/i.test(String(transcript.error))) {
      throw new Error("We couldn't hear any speech in this video, so there's nothing to clip. No Sparks were charged. Try a video where someone is talking.");
    }
    throw new Error(`AssemblyAI transcription failed: ${transcript.error}`);
  }
  const audioSeconds = Number(transcript.audio_duration ?? 0) || (transcript.words?.at(-1)?.end ?? 0) / 1000;
  if (costRunId && audioSeconds > 0) recordProviderUsage({
    runId: costRunId, stage: "transcribe", provider: "assemblyai", model: transcript.speech_model_used ?? null, audioSeconds,
  });
  if (!transcript.words || transcript.words.length === 0) {
    throw new Error("Transcription returned no words — the VOD may have no speech.");
  }

  return {
    words: transcript.words.map((w) => ({ text: w.text, start: w.start, end: w.end })),
    durationSeconds: Math.round(audioSeconds),
  };
}

/**
 * Format word-level timestamps into [mm:ss]-prefixed blocks (~20s each) so
 * Claude can reference precise times without us sending one line per word.
 */
/**
 * Locate every spoken mention of a keyword/phrase in the transcript, word-
 * boundary matched and case-insensitive. Returns the VOD-timeline second of
 * each mention, deduped and sorted — this is the deterministic signal fed
 * into the MIDAS prompt (see keywordSection in findClips) so the model
 * weights those moments during its own scoring pass, rather than us
 * filtering its output after the fact.
 */
export function findKeywordMatches(words: TimedWord[], keyword: string): number[] {
  const trimmed = keyword.trim();
  if (!trimmed || words.length === 0) return [];

  // Join into one searchable string, tracking which word owns each char
  // offset, so a match position maps back to a timestamp.
  let text = "";
  const offsets: { charStart: number; word: TimedWord }[] = [];
  for (const w of words) {
    offsets.push({ charStart: text.length, word: w });
    text += w.text + " ";
  }

  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`\\b${escaped}\\b`, "gi");

  const seconds = new Set<number>();
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text))) {
    // Walk offsets to find the last one starting at or before the match —
    // that's the word the match falls inside.
    let owner = offsets[0]?.word;
    for (const o of offsets) {
      if (o.charStart > m.index) break;
      owner = o.word;
    }
    if (owner) seconds.add(Math.round(owner.start / 1000));
    // Zero-width safety: a pattern that can match an empty string would
    // otherwise loop forever at the same index.
    if (m[0].length === 0) pattern.lastIndex++;
  }
  return Array.from(seconds).sort((a, b) => a - b);
}

/** Render keyword-match timestamps as a MIDAS prompt block instructing the
 *  model to weight — not just filter for — moments near each mention. */
function formatKeywordSection(keyword: string, matchSeconds: number[]): string {
  const stamp = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    return h > 0
      ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
      : `${m}:${String(sec).padStart(2, "0")}`;
  };

  if (matchSeconds.length === 0) {
    return `

## KEYWORD FOCUS

The user searched for "${keyword}" — it does not appear anywhere in this transcript (checked word-by-word, not a judgment call). Do not force a clip toward it; select your best moments overall using the normal process below.`;
  }

  const lines = matchSeconds.map((s) => `[${stamp(s)}] "${keyword}" spoken`);
  return `

## KEYWORD FOCUS

The user specifically wants clips related to "${keyword}". The transcript mentions it at these exact timestamps (word-matched, not inferred):
${lines.join("\n")}

- Treat a nearby keyword mention as a strong additional signal on top of your normal five-dimension scoring — between two otherwise-comparable candidates, prefer the one near a mention.
- A mention is a targeting signal, not a quality override: don't inflate viral_score for a low-energy, context-free namedrop just because it matches. Score it honestly; the keyword breaks ties and nudges genuinely-close candidates over the quality floor, it doesn't replace judgment.
- Still scan the ENTIRE transcript per your normal process below — the keyword is additional signal on top of that scan, not a restriction to only these timestamps. A clearly superior moment elsewhere in the VOD still wins.
- If nothing near a mention clears the quality floor, do not pad the results — return your best moments overall instead.`;
}

/**
 * The CLIP TYPES section of the MIDAS prompt, scoped to the VOD's content
 * type. CLUTCH and BIG_BRAIN rarely apply outside gameplay, so IRL swaps
 * them for STORY_TIME / AWKWARD / PUBLIC_INTERACTION — see
 * CLIP_TYPES_BY_CONTENT in lib/clips.ts for the canonical set.
 */
function clipTypesSection(contentType: ContentType): string {
  const body =
    contentType === "irl"
      ? `- STORY_TIME — the streamer recounting an interesting story or narrative moment. No punchline required — compelling narrative pull (a good yarn, an escalating anecdote) is enough on its own.
- FUNNY — comedy: jokes, bits, absurd situations, perfect timing, banter that lands.
- RAGE — anger and frustration outbursts: genuine tilt, malding, heated venting.
- FAIL — an embarrassing mistake or a plan collapsing in the funniest or most painful way possible.
- AWKWARD — cringe or uncomfortable moments: painful silences, secondhand embarrassment, a joke landing wrong, social friction that makes you wince.
- PUBLIC_INTERACTION — a funny or notable interaction with a stranger or someone in public: a passerby, a store clerk, a random encounter that goes somewhere.
- EMOTIONAL — genuine feeling: heartfelt reactions, near-tears, gratitude to chat, vulnerable or wholesome moments.
- SUS — out-of-pocket moments: accidental innuendo, things said that should NOT have been said, "clip that out of context" material.`
      : `- CLUTCH — high-stakes skilled play under pressure: 1vX wins, last-second saves, impossible comebacks.
- FUNNY — comedy: jokes, bits, absurd situations, perfect timing, banter that lands.
- RAGE — anger and frustration outbursts: controller-slam energy, malding, tilted meltdowns.
- EPIC — jaw-dropping spectacle and peak hype: world-first-feeling moments, massive wins, grand payoffs that aren't primarily about mechanical skill.
- FAIL — spectacular failure: throwing a won game, embarrassing deaths, plans collapsing in the funniest or most painful way possible.
- BIG_BRAIN — outsmarting, not outshooting: 200-IQ strategy, insane predictions, galaxy-brain outplays, "he KNEW" moments.
- EMOTIONAL — genuine feeling: heartfelt reactions, near-tears, gratitude to chat, vulnerable or wholesome moments.
- SUS — out-of-pocket moments: accidental innuendo, things said that should NOT have been said, "clip that out of context" material.`;

  return `## CLIP TYPES

Assign each clip exactly one type — the DOMINANT flavor of the moment:

${body}

If a moment is both funny and a fail, ask: would TikTok caption this as a fail or as a joke? Pick that one.`;
}

/* ── Stage 4: find clippable moments with Claude ── */
export async function findClips(
  transcriptText: string,
  durationSeconds: number,
  chatSpikes: ChatSpike[] | null,
  clipCount: ClipCount,
  contentType: ContentType = DEFAULT_CONTENT_TYPE,
  keyword?: string,
  keywordMatchSeconds: number[] = [],
  priorWindows: { start_seconds: number; end_seconds: number }[] = [],
  creatorPreferences = "",
  costRunId?: string,
  observedWindows?: AudioWindow[],
  /** Which Claude model picks the moments. Pro keeps Opus 4.8; see analysisModelFor in lib/plan-limits.ts. */
  model: string = "claude-opus-4-8",
  /** Loud stretches of the audio (Gaming only), a free signal for streamers who say little. */
  loudMoments: LoudMoment[] = [],
  /** The streamer talks very little, so loud moments and chat carry more weight. */
  quietStream = false,
  /** The transcript is not English: write titles and hooks in the streamer's language. */
  nonEnglish = false
) {
  // Reads ANTHROPIC_API_KEY from env. An organization-scoped key (sk-ant-usr-…)
  // is rejected with "This API key is not scoped to a workspace" unless the
  // request names the workspace, so pass it through when one is configured.
  // A workspace-scoped key needs no header and ignores this.
  const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
  const client = new Anthropic(
    workspaceId ? { defaultHeaders: { "anthropic-workspace-id": workspaceId } } : {}
  );
  const validTypes = CLIP_TYPES_BY_CONTENT[contentType];

  const spikeSection = chatSpikes
    ? `

## CHAT REPLAY SPIKES

Chat replay spikes are provided below the transcript. A spike means the live audience ERUPTED at that moment — messages-per-second jumped far above the stream's baseline. This is the strongest external engagement signal you have:

- Treat transcript moments near a spike as prime clip candidates and weight their hype dimension heavily — the live audience already voted with their keyboards. A spike aligned with a moment confirms the CHAT_EXPLOSION signal for that clip.
- Weigh the intensity multiplier: 5×+ means the audience erupted and the cause is near-certainly clip-worthy; 2-3× is a solid nudge, not proof. You get timestamps and intensity only — no message text — so infer WHAT chat reacted to from the transcript around the spike.
- Chat reacts a few seconds AFTER the moment — the clippable action usually starts 5-15 seconds BEFORE the spike timestamp. Anchor the clip on what caused the spike, not the spike itself.
- A spike is evidence, not a verdict: only pick the moment if the transcript supports a self-contained clip. Never clip a spike whose cause isn't visible in the transcript.
- Absence of a spike does not disqualify a moment — quiet-audience gems still clip well.`
    : "";

  const keywordSection = keyword?.trim() ? formatKeywordSection(keyword.trim(), keywordMatchSeconds) : "";
  const loudSection = contentType === "gaming" ? formatLoudMomentsForPrompt(loudMoments, quietStream) : "";
  // Roleplay and talk-heavy gaming (GTA-style RP): the clip is what is said, not what is played.
  const roleplaySection = contentType === "gaming"
    ? `\n\n## ROLEPLAY AND DIALOGUE-DRIVEN GAMING\n\nMany gaming streams, especially roleplay servers (GTA-style RP), are improvised dialogue with the game as the background. For these the clip is what is SAID, not what is played, so do not look only for skill, rage or loud audio.\n- Treat these as top-tier moments: a quotable catchphrase or comeback ("Who on Money Time? Me."), an in-character confession or complaint, a funny misunderstanding (police mistaking a piece of bread for drugs), an ironic mini-story where a plan backfires, a roast or clapback that ends on a closing line, a deadpan one-liner, a confident boast.
- More patterns that reliably work as standalone clips, look for each on purpose: a diss built on an absurdly specific phrase that could become a sound or a meme ("I'm on Money Time and you on Dick Running Time"); a relatable confession about not knowing something everyone is supposed to know, ending on a resigned line; a character trying to help and making it worse, then panicking about the consequence; a dismissive put-down of someone who just pulled out a weapon, followed by a physical or visual payoff; a fake flex (borrowed jewelry, an exaggerated number) that collapses on the punchline; a contradiction played completely straight ("I just came home" / "you don't live here"); a flirting mix-up (the wrong name, a number written down) that resolves on a witty last line; a boast with an absurd number ("I killed 50 before, but five more for the gang"). These are 15-35 seconds, need almost no context, and are exactly what GTA RP meme pages post.
- In a long roleplay stream, several of these moments often happen in the same scene a minute apart. Return each distinct moment separately; only merge cuts that overlap or repeat the same line.\n- Score them for the audience that gets them. Character names, crews, server slang and in-world jargon are PART of the appeal: never mark a clip down for needing roleplay knowledge. Mark it down only when the point is truly lost without that knowledge.\n- Hype and skill can honestly be near zero. A clean setup, a turn, and a last line that lands can score 70-85, and a quotable line with a clear comeback can score 80 or more. Judge hook, payoff, quotability and share trigger.`
    : "";
  const languageNote = nonEnglish ? languageSection() : "";
  const priorSection = priorWindows.length
    ? `\n\n## MOMENTS ALREADY DELIVERED TO THIS USER\n\nThese time ranges were already sold from this VOD. Find the next best genuinely different moments outside these ranges. Do not return a clip within 60 seconds of any listed start or overlapping a listed range. If no other moment clears the quality floor, return an empty clips array.\n${priorWindows.map((w) => `- ${Math.round(w.start_seconds)}s to ${Math.round(w.end_seconds)}s`).join("\n")}`
    : "";
  const preferenceSection = creatorPreferences
    ? `\n\n## CREATOR FEEDBACK\n${creatorPreferences} Use this only as a tiebreaker between equally strong candidates. Never lower the quality floor or change factual scoring to match taste.`
    : "";

  const request = {
    model,
    // 16,000 is the most the cost guard (lib/provider-budget-core.ts) will price, and the early budget check is built on it. Adaptive
    // thinking spends output tokens too, so 15 clips plus the longer gaming instructions can reach it and cut the answer off, usually
    // in the near-miss list after the main one. When that happens the complete clips are kept (salvageClipsJson) instead of failing.
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: `You are MIDAS — Klyp's Moment Identification & Analysis System.

You are the analysis brain of a professional clipping pipeline. Think of yourself as a veteran short-form editor who has cut thousands of Twitch and YouTube VODs into clips that hit millions of views on TikTok, Shorts, and Reels. Streamers pay for your judgment: you watch hours of footage so they don't have to, and you surface ONLY the moments a top human editor would fight to clip. Your picks go straight into production — precision beats volume, and a mediocre pick wastes a creator's time and money.

## CONTENT TYPE

This VOD is tagged **${contentType === "irl" ? "IRL" : "Gaming"}** content${contentType === "irl" ? " — vlogging, outdoors, public outings, IRL/social streaming, not gameplay" : " — gameplay-focused streaming"}. The CLIP TYPES section below is scoped to this content type — assign ONLY those types, never one from the other content type's set.

## YOUR INPUT

- A speech transcript of the VOD with [mm:ss] (or [h:mm:ss]) timestamps roughly every 20 seconds. Total duration: ${durationSeconds} seconds.
- Optionally, chat replay spikes — timestamps where live-chat activity exploded, with an intensity multiplier (how many × the stream's average chat speed). No message text is included.

You cannot see the video. Reconstruct what happened on screen from the evidence in speech: gameplay callouts ("he's one shot", "behind you"), sudden screaming or dead silence, laughter, breathing, repeated phrases, tone whiplash, the streamer reading chat ("chat did you SEE that"), self-narration after a play, apologies after a fail. These are your camera.

## HOW TO ANALYZE

Read the ENTIRE transcript before selecting anything — never pick greedily from the first half. Track running storylines: bits the streamer keeps returning to, promises made early ("if I win this I'll..."), rivalries, long setups that pay off later. A callback moment scores higher when you can see the setup it pays off.

THIS IS A TWO-PHASE TASK. Do not stop scanning once you have enough candidates to fill the requested count — a moment late in the VOD can outscore everything you found early on, and you will only see that if you finish the scan first.

PHASE 1 — CANDIDATE POOL: Scan the full transcript start to finish and build a mental list of EVERY moment that clears the quality floor (viral_score ≥ 65), no matter how many that is or where in the VOD they fall. Score each on the five dimensions as you go. Do not discard candidates yet, and do not stop early because you've already found "enough."
PHASE 2 — SELECTION: Only after Phase 1 is complete, sort the full candidate pool by viral_score descending and keep the top ${clipCount} (fewer if the pool has fewer than ${clipCount} candidates — see FINAL SELECTION). The requested count controls how many you KEEP, never how many you SCAN for.

Score every candidate moment on five dimensions, 0-20 each:

1. HYPE — is the audience going wild? Chat spikes, the streamer acknowledging chat blowing up, crescendo moments, win screens, clutch reveals.
2. EMOTIONAL INTENSITY — pop-offs, screaming, genuine anger, near-tears, stunned silence, voice cracking. Raw, unperformed emotion travels furthest.
3. SKILL SHOWCASE — incredible mechanical plays, 1vX clutches, galaxy-brain strategy, speedrun-tier execution, anything that makes viewers ask "how?".
4. COMEDIC VALUE — jokes that land, absurd situations, perfect comedic timing, spectacular fails, accidental innuendo, chat-streamer banter.
5. STORYLINE SIGNIFICANCE — key plot beats of the stream: the moment the run dies, the bet gets paid, the callback lands, the arc concludes.

Report those five numbers in the "dimensions" field of every clip you return. They are the working behind the score, so report what you actually judged — never reverse-engineer them from viral_score, and never flatten them to make a clip look balanced. A 19/2/0/4/7 is a more useful answer than five 8s, and the breakdown is shown to the streamer.

viral_score (1-100) is your holistic judgment informed by those dimensions — NOT their sum. A clip that maxes one dimension (a 20/20 comedic moment) beats a clip that's mediocre at everything. Also weigh: does it work with ZERO context for a viewer who has never seen this streamer? Is there a quotable line? Is it relatable outside this game's community? SHARE TRIGGER: ask who would send this to a friend, save it, or comment on it, and why. A clip with a clear answer ("anyone who has ever cancelled plans", "anyone who streams to a small audience") earns real credit here even when it is calm and quiet.

Calibrate honestly. 90+ means "this could genuinely go viral" — most VODs have zero or one such moment. 75-89 is a strong clip any editor would post. 65-74 is solid but unremarkable. Below 65 does not get returned at all (see FINAL SELECTION). NEVER inflate scores to make a boring VOD look good — streamers trust the number, and an inflated score sneaks a weak clip past the quality floor.

## THE 6 SIGNALS OF A CLIPPABLE MOMENT

Do NOT just pick moments that feel generically "interesting." Run six deliberate detection passes over the transcript — one per signal below, in this priority order — and collect candidates from each pass before scoring anything. When two candidates are otherwise comparable, prefer the one triggered by the higher-priority signal. Every clip you return must be triggered by at least one signal, reported in its "signals" field (most dominant first).

1. UNEXPECTED_TURN — a setup followed by a twist or payoff, ideally landing 15-45 seconds after the setup: a confident claim that immediately backfires, a plan that inverts, a prediction that comes true absurdly fast. The clip must contain BOTH the setup and the payoff — a setup with no payoff isn't a clip, it's dead air; do not select it.
2. REACTION_SPIKE — a genuine, extreme reaction (shock, laughter, rage, disgust) that erupts within ~2 seconds of its trigger. In transcript: sudden screaming, sentences cut off mid-word, cursing bursts, laughter breaking through speech, "NO WAY"/"WHAT", instant tone whiplash from calm to explosive. Delayed or performed reactions don't count.
3. RELATABLE_QUOTABLE — a standalone one-liner, hot take, or observation that would work as a screenshot or text post with no video, OR a short relatable confession: one complete thought of roughly 15-25 seconds that a stranger would recognise from their own life. Big energy NOT required — deadpan delivery counts. Test: would this work as a tweet, or would someone send it to a friend with "this is literally me"?
4. CHAT_EXPLOSION — the live audience erupting: chat message-rate spiking far above the stream's baseline. Assign this signal ONLY when chat replay spike data is present in your input AND a spike aligns with the moment (chat lags the cause by 5-15 seconds — anchor on the cause). If no chat data was provided, never assign this signal.
5. CONFLICT — callouts, arguments, beef between people in or around the stream: streamer vs teammate, streamer vs chat, trash talk that escalates, genuine tension. Weight it higher when the tension resolves in a way nobody saw coming (an apology that lands sideways, the argument flipping into laughter, a comeback that ends it cold) rather than fizzling out or resolving exactly as expected. Real friction only — scripted bits belong under other signals.
6. CHAOS — bizarre, random, or off-topic moments unrelated to the main stream content: non-sequiturs, absurd tangents, unexplainable events, "why is this happening" energy.

DEPRIORITIZE — these rarely make good clips even when nothing about them is technically wrong:
- Slow builds: a moment that needs a long runway to get anywhere. If the payoff doesn't land within roughly the first 45 seconds, it's a weak candidate no matter what happens after.
- Setup without payoff: a promising claim, bet, or buildup that the transcript never resolves. Half a moment is not a moment — this is UNEXPECTED_TURN's own rule above, generalized to every signal.
- Anything that would only work by stretching past ~90 seconds. The 15-60s boundary below already enforces a hard cap tighter than this — don't reach for a marginal moment that only makes sense if you imagine a longer window than you're allowed to cut.
- Calm, low-energy talking with no turn, tension, or punchline. A streamer explaining something clearly but flatly, in a level conversational tone, is not a clip — it never goes viral no matter how interesting the content is. If nothing in the signal list above actually fires on a moment, that absence is usually exactly this: skip it. Never select a moment on vibes alone; every clip needs a real, identifiable trigger.

STORIES ARE NOT FLAT TALKING. A streamer telling a short, self-contained story with a clear setup, a turn, and a payoff line is clippable even when the delivery is calm or deadpan: a party that ends in an eviction warning, a random encounter that ends in an absurd invitation, a bad day that ends in a perfect one-liner. These are UNEXPECTED_TURN or RELATABLE_QUOTABLE moments. Look for them on purpose, in every part of the VOD, not only the loud parts. Judge a story clip on its hook (does the first line make a stranger stop?), its payoff (does the last line land?), and how relatable it is to someone who has never seen this streamer. Do NOT mark it down for lacking hype or skill: for a story, the storyline and comedic dimensions carry the score, and a story with a strong hook and a clean payoff can honestly score 70-85. A story with no payoff, or one that needs a paragraph of context, still does not clip.

RELATABLE MOMENTS ARE CLIPS TOO. Short, calm moments that top clip channels post all the time are easy to miss because nobody screams. Look for them on purpose, in every part of the VOD:
- A relatable confession or honest observation about life ("I agree to plans while excited, then the date arrives and I just don't want to go").
- An honest self-own or deadpan self-deprecating answer, especially to a chat question, ending on an absurd or unexpected punchline.
- A quirky bit or odd decision played straight (letting a coin flip decide something silly).
- A sincere gratitude or community moment (coming back after a break and thanking the few viewers who stayed).
- A short gross-out or embarrassing mini-story with a clean last line.
These are often only 15-25 seconds: one thought, one turn, one ending (never under 15 seconds). Short is a strength. Judge them on hook, payoff, relatability and share trigger, never on hype or skill, and never on how loud the streamer is. The rule against calm, flat talking is for talking with NO turn and NO payoff; it does not apply to these.

Signals are your DETECTION layer; the five scoring dimensions remain your JUDGMENT layer. A moment found by any signal still has to earn its viral_score and clear the quality floor.

IMPORTANT: "signals" is its own output field, separate from "type" (next section). Signal names (UNEXPECTED_TURN, REACTION_SPIKE, RELATABLE_QUOTABLE, CHAT_EXPLOSION, CONFLICT, CHAOS) go ONLY in the signals array — never in the type field.

${clipTypesSection(contentType)}

"type" and "signals" are DIFFERENT fields with DISJOINT vocabularies — never mix them:
- type: exactly ONE of the ${validTypes.length} clip types above (${validTypes.join(", ")}). NEVER a signal name.
- signals: one or more of the 6 signal names ONLY. NEVER a clip type.

Correct pairings look like:
- {"type": "RAGE", "signals": ["REACTION_SPIKE", "CHAT_EXPLOSION"]} — streamer exploded at a stream snipe, chat erupted
- {"type": "FUNNY", "signals": ["UNEXPECTED_TURN"]} — confident plan instantly backfires, played for laughs
- {"type": "SUS", "signals": ["RELATABLE_QUOTABLE"]} — out-of-pocket one-liner that works as a screenshot
Wrong: {"type": "REACTION_SPIKE", ...} — REACTION_SPIKE is a signal, not a type.

## CLIP BOUNDARIES

- 15-60 seconds per clip is the hard range, but AIM FOR 15-35 seconds. A single-thought clip of 15-25 seconds with a clean ending is ideal; never stretch a short moment to reach a length. Go past 45 only when the payoff truly cannot land sooner. Viewers drop off fast, so a tight 27-second clip beats a loose 50-second one of the same moment.
- Start on the HOOK: the first word of the line that makes a stranger stop scrolling. Skip warm-up chatter, apologies, "so anyway" lead-ins and rambling before it. The trigger must land within the first 5 seconds.
- End on the PUNCHLINE: the last word of the payoff or reaction. Cut everything after it: no wrap-up, no new topic, no extra detail, no "anyway". If the same point is repeated, end after the strongest version.
- start_quote and end_quote: copy the first 4-8 words and the last 4-8 words of the clip EXACTLY as they appear in the transcript, word for word, so the cut can be snapped to them. The transcript only has a time stamp every 20 seconds, so these quotes are how the exact cut points are found. Never invent or paraphrase them.
- start_seconds / end_seconds must lie within the VOD duration (${durationSeconds}s) and align with the transcript timestamps.
- Pad the start a few seconds before the key line so the viewer gets setup — but never so much that the payoff arrives late. The best clips put the trigger inside the first 5 seconds.
- End on the peak: cut right after the punchline, the win, or the reaction settles. Trailing dead air kills rewatch rate.
- Each clip must be SELF-CONTAINED: someone scrolling at 2am with no context must understand it. If a moment needs a paragraph of explanation, it doesn't clip — no matter how good it felt live.

## TITLES, HOOKS, CAPTIONS

- title: short and PUNCHY, written like a top-performing TikTok caption. Use caps for EMPHASIS on the key word, an emoji where it earns its place, and concrete specifics over generic hype ("He hit the 1HP clutch and chat LOST IT 😭" beats "Insane gaming moment"). Never spoil the payoff — sell the moment, don't summarize it. For relatable, story and confession clips, a curiosity question also works well and may replace the caption style ("Why he cancels plans at the last minute", "Why his viewers dropped from 1,000 to 80"): name the topic, keep the answer for the clip.
- hooks: exactly 3 alternative on-screen hook lines, burned over the first 3 seconds of the clip in big meme-caption text. Write them as REACTION/CALLOUT statements about the moment — the style a clips channel would slap on screen: "RAKAI CRASHED OUT", "HE ONE-SHOT THE FINAL BOSS", "CHAT MADE HIM RAGE QUIT". HARD LIMIT: under 8 words each. Punchy callouts, not sentences — no hashtags, no trailing punctuation. Each of the 3 takes a DIFFERENT angle on the same moment (the reaction, the stakes, the absurdity). They render in ALL CAPS on screen, so write text that works uppercased.
- caption: 1-2 social-ready sentences with 2-4 relevant hashtags (game name, #clutch/#fail/#gaming-style tags, trending where genuinely fitting).
- reason: 2-3 plain sentences telling the streamer, editor-to-editor, why this moment earns its score. Name the arc (setup, turn, payoff), quote the exact punchline line that lands, say what a viewer would DO with it (comment, tag a friend, use the line as a sound or a meme, rewatch) and who, and why (for example "anyone who has cancelled plans last minute"), and finish with why it is NOT scored higher (for example repetition, a slow start, or no visual payoff). If you quote a line, quote only the punchline that is inside the clip.

- Never put a slur or other hateful or platform-flagged word in a title, hook, caption or reason, even when the streamer says it in the clip. Describe the moment in clean words instead; the clip's own audio is not changed.

## THUMBNAIL FRAME

- thumbnail_seconds: the single timestamp inside the clip where the frame is most expressive — peak reaction face, the win screen, the moment of impact. This is usually at or just after the emotional peak, NOT the start of the clip.

## FINAL SELECTION

- From your full Phase 1 candidate pool, return the TOP ${clipCount} by viral_score, highest first — never the first ${clipCount} you happened to find while scanning. A late-VOD 88 always beats an early-VOD 74, full stop.
- QUALITY FLOOR: include a clip ONLY if its viral_score is 65 or higher. If the VOD has just 3 genuinely great moments, return 3 — NEVER pad the list with filler to hit the count. The streamer is charged per clip returned; a weak clip costs them money and trust.
- Prefer variety ONLY as a tiebreaker between near-identical scores (within ~2 points): a wall of RAGE clips from one VOD is a worse deliverable than a spread of types. Variety is NEVER a reason to drop a higher-scoring moment for a lower-scoring one — score ranking always wins.
- Do not pick overlapping or near-duplicate moments; if one moment produces two candidate windows, pick the better cut.

## ALSO CONSIDER (near-misses, separate list)

After your main list, fill "also_consider" with the next-best moments that scored 40-64, below the quality floor, best first, so the full list reaches ${clipCount} clips whenever the footage has enough real moments. Do this whenever your main list has fewer than ${clipCount} clips; if the main list is already full, return an empty list. If NO moment cleared 65 ("best of this stream"), still return the best real moments you found here (scores 40-64), so a quiet or small streamer is never left empty-handed. Only real moments the footage supports, never invented ones and never filler; if nothing scored at least 40, return an empty list. At most (${clipCount} minus your main list length) moments. Use the same fields as a clip, and the same rules: they must not overlap, or start within 60 seconds of, any main pick or each other. These are extras, never replacements: do not move a 65+ moment here, do not lower any main pick's score to fit, and do not change anything in your main list because of them.${spikeSection}${loudSection}${roleplaySection}${languageNote}${keywordSection}`,
    messages: [
      {
        role: "user",
        content:
      `Here is the transcript of the VOD (duration: ${durationSeconds}s). Find up to ${clipCount} clippable moments that clear the quality floor.${observedWindows ? " Only the supplied timestamp windows were transcribed; gaps are unobserved, not boring. Return a clip only when its entire setup and payoff fit within observed footage." : ""}\n\n${transcriptText}${priorSection}${preferenceSection}` +
          (chatSpikes ? `\n\n${formatSpikesForPrompt(chatSpikes)}` : ""),
      },
    ],
    output_config: { format: zodOutputFormat(clipAnalysisSchemaForContentType(contentType)) },
  } as Anthropic.MessageCreateParamsNonStreaming;
  // Reserve against the request's REAL input size when the API can count it (the counting call is
  // free), never more than the old byte-based bound, and fall back to that bound if counting fails.
  const selectQuote = await quoteSelectMessage({
    model,
    requestText: JSON.stringify(request),
    maxOutputTokens: request.max_tokens,
    countInputTokens: async () => (await client.messages.countTokens({
      model: request.model, system: request.system, messages: request.messages,
      thinking: request.thinking, output_config: request.output_config,
    }, { timeout: 20_000, maxRetries: 1 })).input_tokens,
  });
  if (costRunId) console.log(`[analysis-budget] select reservation ${selectQuote.microUsd} micro-USD (${selectQuote.basis})`);
  const { data: response, response: rawResponse } = await budgetForRun(costRunId).call('select',
    selectQuote.microUsd,
    () => client.messages.create(request, { maxRetries: 0 }).withResponse());

  logAnthropicRateLimits(rawResponse.headers, "findClips");
  if (costRunId) recordProviderUsage({
    runId: costRunId, stage: "select", provider: "anthropic", model,
    inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
  });

  // Lenient per-clip validation: messages.parse() rejects the WHOLE response if
  // any single clip is malformed (e.g. a signal name in the "type" field), which
  // wastes the entire download+transcribe run. Instead, validate each clip
  // individually — skip bad ones with a warning, keep the rest.
  const text = response.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error("Claude returned no structured output.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // A cut-off answer (output limit reached) still holds every clip written in full before the cut: keep those.
    const kept = response.stop_reason === "max_tokens" ? salvageClipsJson(text) : null;
    if (!kept) throw new Error("Claude returned output that was not valid JSON.");
    console.warn("[analyze] the answer hit the output limit; kept the clips written out in full");
    parsed = JSON.parse(kept);
  }
  const rawClips = (parsed as { clips?: unknown }).clips;
  if (!Array.isArray(rawClips)) {
    throw new Error("Claude returned output that did not match the expected schema.");
  }

  const clipSchema = clipSchemaForContentType(contentType);
  const clips: Clip[] = [];
  const extraCandidates: Clip[] = [];
  const rawExtras = (parsed as { also_consider?: unknown }).also_consider;
  if (Array.isArray(rawExtras)) {
    for (const raw of rawExtras) {
      const result = clipSchema.safeParse(raw);
      if (result.success) extraCandidates.push(result.data); // a malformed extra is simply dropped
    }
  }
  let skipped = 0;
  for (const raw of rawClips) {
    const result = clipSchema.safeParse(raw);
    if (result.success) {
      clips.push(result.data);
    } else {
      skipped++;
      console.warn(
        "[analyze] skipping malformed clip from Claude:",
        result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
      );
    }
  }
  if (clips.length === 0 && skipped > 0) {
    throw new Error("Claude returned clips but none matched the expected schema — try re-running the analysis.");
  }

  if (observedWindows) {
    const before = clips.length;
    const observed = clips.filter(clip => clipInsideObservedCoverage(clip, observedWindows));
    clips.length = 0;
    clips.push(...observed);
    if (before !== clips.length) console.warn(`[analyze] rejected ${before - clips.length} clip(s) outside observed transcript coverage`);
  }
  // Safety net: the prompt asks Claude to return clips ranked by viral_score
  // descending, but model compliance isn't guaranteed — always re-sort here so
  // the final output order is correct regardless of what order Claude used.
  clips.sort((a, b) => b.viral_score - a.viral_score);

  // Safety net #2: the prompt also asks Claude not to return overlapping or
  // near-duplicate moments, but it sometimes returns several clips anchored
  // within seconds of each other (e.g. 4 clips all starting around 2:40:40).
  // Greedily keep the highest-scoring clip in each 30s start-time window and
  // drop the rest — clips is already sorted by viral_score descending, so the
  // first clip claiming a window is always its best one.
  const DEDUPE_WINDOW_S = 30;
  const deduped: Clip[] = [];
  for (const clip of clips) {
    const collides = [...priorWindows, ...deduped].some(
      (kept) => Math.abs(kept.start_seconds - clip.start_seconds) < DEDUPE_WINDOW_S ||
        (kept.start_seconds < clip.end_seconds && kept.end_seconds > clip.start_seconds)
    );
    if (!collides) deduped.push(clip);
  }
  const duplicatesDropped = clips.length - deduped.length;
  if (duplicatesDropped > 0) {
    console.log(
      `[analyze] dropped ${duplicatesDropped} clip(s) within ${DEDUPE_WINDOW_S}s of a higher-scoring clip`
    );
  }
  clips.length = 0;
  const mainPicks = deduped.filter(clip => clip.viral_score >= 65).slice(0, clipCount);
  const observedExtras = observedWindows ? extraCandidates.filter(clip => clipInsideObservedCoverage(clip, observedWindows)) : extraCandidates;
  const extras = pickExtras({ mainPicks, candidates: observedExtras, requestedCount: clipCount, priorWindows });
  clips.push(...mainPicks, ...extras);
  if (extras.length > 0) console.log(`[analyze] added ${extras.length} near-miss extra(s) after ${mainPicks.length} top pick(s)`);

  console.log(
    `[analyze] content=${contentType} types:`,
    clips.map((c) => c.type).join(", ") || "(none)"
  );

  return { clips, skipped };
}

export type PipelineProgress = (stage: AnalyzeStage, status: "running" | "done", etaSeconds?: number, reused?: boolean) => void;

export type PipelineResult = {
  clips: (Clip & { words: TimedWord[] })[];
  boundaryReview?: FlaggedClip<Clip>[];
  skipped: number;
  durationSeconds: number;
  transcriptChars: number;
  /** Full VOD-level word transcript — returned so the caller can persist it
   *  (see lib/transcripts.ts). Not scoped to any single clip. */
  words: TimedWord[];
  /** The streamer talks very little (under about 40 words a minute). */
  quiet?: boolean;
};

/**
 * Runs stages 2-4 (download/extract → transcribe → find clips) to completion.
 * Auth, Sparks, SSE, and DB persistence are the caller's job — see
 * app/api/analyze/route.ts (interactive) and lib/vod-poll.ts (auto-clip).
 */
/**
 * Per-stage memory accounting. Logged for every analysis so a future OOM can
 * be attributed to a specific stage from the logs alone, instead of inferred
 * from GC dumps after the fact.
 */
function memSnapshot(label: string): { heap: number; rss: number } {
  const m = process.memoryUsage();
  const heap = m.heapUsed / 1048576;
  const rss = m.rss / 1048576;
  const ext = m.external / 1048576;
  console.log(
    `[mem] ${label} heap=${heap.toFixed(1)}MB rss=${rss.toFixed(1)}MB external=${ext.toFixed(1)}MB`
  );
  return { heap, rss };
}

/** Run one pipeline stage, logging its heap/RSS delta and wall time. */
async function withMem<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const before = memSnapshot(`${name} before`);
  const startedAt = Date.now();
  try {
    return await fn();
  } finally {
    const after = memSnapshot(`${name} after`);
    console.log(
      `[mem] ${name} DELTA heap=${(after.heap - before.heap >= 0 ? "+" : "")}${(after.heap - before.heap).toFixed(1)}MB ` +
        `rss=${(after.rss - before.rss >= 0 ? "+" : "")}${(after.rss - before.rss).toFixed(1)}MB ` +
        `in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`
    );
  }
}

export async function runAnalysisPipeline(opts: {
  uploadedPath: string | null;
  url: string;
  durationHint: number | undefined;
  clipCount: ClipCount;
  workDir: string;
  /** Gaming vs IRL — controls which clip types MIDAS may assign. Defaults to
   *  gaming for callers that don't have a per-request choice (e.g. the
   *  auto-clip background worker in lib/vod-poll.ts). */
  contentType?: ContentType;
  /** Optional keyword/phrase from the analyze form — when set, moments near
   *  a spoken mention are weighted higher during clip selection (see
   *  findKeywordMatches / formatKeywordSection). Undefined falls back to
   *  scanning the whole VOD for the best overall moments, unchanged. */
  keyword?: string;
  /** Previously delivered windows for this user and VOD. */
  priorWindows?: { start_seconds: number; end_seconds: number }[];
  creatorPreferences?: string;
  chatSpikesPromise?: Promise<ChatSpike[] | null> | null;
  costRunId?: string;
  sourceKey?: string;
  userId?: string;
  client?: SupabaseClient;
  onProgress?: PipelineProgress;
  /**
   * Analyze only the best N seconds of a longer video (the free "best 2 hours" choice, "Smart pick"). The loudest, most active
   * stretch is found from the audio; everything after that stays on the video's own timeline, so clip times point at the right
   * place. The transcript is then never treated as full coverage.
   */
  partSeconds?: number;
  /** The whole video's length in seconds, needed with partSeconds to know how far the window can slide. */
  sourceSeconds?: number;
  cachedTranscript?: { words: TimedWord[]; durationSeconds: number; coverageMode: "full" | "chat-sampled" };
  onTranscript?: (transcript: { words: TimedWord[]; durationSeconds: number; coverageMode: "full" | "chat-sampled" }) => Promise<void>;
  onAnalysis?: (result: PipelineResult) => Promise<void>;
  /** Claude model for the moment-picking step (Free and Pro can differ). Defaults to Pro's model. */
  model?: string;
  /** Which service transcribes the audio. Defaults to AssemblyAI; see transcriberFor in lib/plan-limits.ts. */
  transcriber?: "assemblyai" | "groq";
}): Promise<PipelineResult> {
  // Check before downloading or transcribing, both of which can incur costs.
  anthropicCreditGate.assertAvailable();
  const { uploadedPath, url, durationHint, clipCount, workDir, onProgress, partSeconds } = opts;
  /** Where the analyzed part starts on the video's own timeline (0 unless Smart pick found a better stretch). */
  let windowStart = 0;
  /** The length of the analyzed part, once transcribed. */
  let partLength: number | undefined;
  const cachedTranscript = opts.cachedTranscript?.coverageMode === "full" ? opts.cachedTranscript : undefined;
  const contentType = opts.contentType ?? DEFAULT_CONTENT_TYPE;
  const keyword = opts.keyword;
  const progress: PipelineProgress = onProgress ?? (() => {});

  memSnapshot("pipeline start");

  // Full coverage is required regardless of clip count. Chat-spike-only
  // sampling would miss quiet entertaining moments.
  const canSegment = false;
  let spikesForPlan: ChatSpike[] | null = null;
  if (canSegment) {
    spikesForPlan = await (
      opts.chatSpikesPromise ?? detectChatSpikes(url, durationHint!).catch(() => null)
    );
  }
  const windows =
    canSegment && spikesForPlan?.length ? spikeWindows(spikesForPlan, durationHint!) : [];

  if (!cachedTranscript) progress("download", "running", durationHint ? Math.max(10, Math.round(durationHint / 60)) : undefined);
  let words: TimedWord[];
  let durationSeconds: number;
  let loudMoments: LoudMoment[] = [];

  if (cachedTranscript) {
    words = cachedTranscript.words;
    durationSeconds = cachedTranscript.durationSeconds;
    progress("download", "done", undefined, true);
    progress("transcribe", "done", undefined, true);
  } else if (windows.length > 0) {
    const totalWindowS = windows.reduce((sum, w) => sum + (w.end - w.start), 0);
    console.log(
      `[analyze] segmented: ${windows.length} windows, ${totalWindowS}s of audio ` +
        `instead of ${Math.round(durationHint!)}s of full VOD`
    );
    const paths = await withMem("download", () =>
      mapWithConcurrency(windows, SEGMENT_CONCURRENCY, (w) => downloadAudioWindow(url, workDir, w))
    );
    progress("download", "done");

    progress("transcribe", "running", Math.max(20, Math.round(totalWindowS * 0.25)));
    words = await withMem("transcribe", () => transcribeWindows(paths, windows, opts.costRunId));
    if (words.length === 0) {
      throw new Error("Transcription returned no words — the VOD may have no speech.");
    }
    // The VOD's real length, not the sampled total: clip bounds and the prompt
    // both reason about positions in the original stream.
    durationSeconds = Math.round(durationHint!);
  } else {
    if (durationHint && durationHint >= SEGMENT_MIN_VOD_S) {
      const ceiling = Number(process.env.KLYP_MAX_VOD_ESTIMATED_USD ?? 5);
      const budget = reviewProcessingBudget([{ start: 0, end: durationHint }], ceiling, { extendedBudget: true });
      if (budget.requiresReview) {
        // Refused before any download or paid call: nothing was spent and nothing is charged.
        if (budget.exceedsRunLimit && budget.maxRunHours) throw new Error(`This video is too long to analyze in one pass (about ${budget.maxRunHours} hours is the most for a full transcript). No Sparks were charged. Trim it or split it into parts and try again.`);
        throw new Error(`This VOD needs an estimated $${budget.projectedUsd.toFixed(2)} processing budget, above the $${ceiling.toFixed(2)} limit. No audio was dropped; review the budget before continuing.`);
      }
    }
    const audioPath = await withMem("download", async () => {
      if (uploadedPath) return extractAudio(uploadedPath, workDir);
      // The source is longer than the part being analyzed, so it is downloaded as a long video and cut down afterwards.
      const full = await downloadAudio(url, workDir, partSeconds ? true : !!durationHint && durationHint >= SEGMENT_MIN_VOD_S);
      if (!partSeconds) return full;
      // Smart pick: read the whole audio's loudness (free, on this server) and take the liveliest stretch. Any problem means the start.
      const samples = await readLoudSamples(full, { run, readText: (p) => readFile(p, "utf8"), ffmpeg: resolveBin("ffmpeg"), outPath: path.join(workDir, "smartpick-loudness.txt") });
      windowStart = bestWindowStart(samples, opts.sourceSeconds ?? partSeconds, partSeconds);
      console.log(`[analyze] smart pick: part starts at ${windowStart}s of ${opts.sourceSeconds ?? "?"}s (${samples.length} loudness readings)`);
      return trimAudioToPart(full, workDir, windowStart, partSeconds);
    });
    progress("download", "done");
    // Gaming streamers can play well and say little, so measure the audio's loud moments too. It runs on this
    // server for free, and a failure here only means no hints.
    if (contentType === "gaming") {
      const measured = await withMem("loud-moments", () => detectLoudMoments(audioPath, {
        run, readText: (p) => readFile(p, "utf8"), ffmpeg: resolveBin("ffmpeg"), outPath: path.join(workDir, "loudness.txt"),
      }));
      // Measured on the analyzed part, so put them back onto the video's own timeline.
      loudMoments = measured.map((m) => ({ ...m, start_seconds: m.start_seconds + windowStart, end_seconds: m.end_seconds + windowStart, peak_seconds: m.peak_seconds + windowStart }));
      console.log(`[analyze] loud moments: ${loudMoments.length}`);
    }

    progress("transcribe", "running", durationHint ? Math.max(20, Math.round(durationHint * 0.25)) : undefined);
    const result = await withMem("transcribe", () => transcribe(audioPath, opts.costRunId, true, opts.transcriber));
    if (partSeconds) {
      // Back onto the video's own timeline: the part's transcript starts at zero, the part itself did not.
      words = result.words.map((w) => ({ ...w, start: w.start + windowStart * 1000, end: w.end + windowStart * 1000 }));
      partLength = result.durationSeconds;
      durationSeconds = windowStart + result.durationSeconds;
    } else {
      words = result.words;
      durationSeconds = result.durationSeconds;
    }
  }
  const quietStream = isQuietStream(words.length, partLength ?? durationSeconds);
  const nonEnglish = !isMostlyEnglish(words);
  if (quietStream) console.log(`[analyze] quiet stream: ${words.length} words in ${Math.round((partLength ?? durationSeconds) / 60)} min`);
  const coverageMode = cachedTranscript?.coverageMode ?? (windows.length || partSeconds ? "chat-sampled" : "full");
  if (!cachedTranscript) await opts.onTranscript?.({ words, durationSeconds, coverageMode });
  if (opts.costRunId) console.log(`[analysis-usage] ${JSON.stringify({ runId: opts.costRunId, vodSeconds: durationSeconds, mode: coverageMode })}`);
  console.log(`[mem] transcribe produced ${words.length} words`);
  if (!cachedTranscript) progress("transcribe", "done");

  progress("analyze", "running", Math.min(90, 30 + Math.round(durationSeconds / 120)));
  let chatSpikesPromise = opts.chatSpikesPromise;
  if (spikesForPlan) {
    chatSpikesPromise = Promise.resolve(spikesForPlan); // already resolved above
  } else if (!chatSpikesPromise && !uploadedPath) {
    chatSpikesPromise = detectChatSpikes(url, durationSeconds).catch(() => null);
  }
  const transcriptText = await withMem("format-transcript", async () => formatTranscript(words, { dropFillers: true }));
  console.log(`[mem] transcript is ${(transcriptText.length / 1048576).toFixed(1)}MB of text`);
  const chatSpikes = await withMem("chat-spikes", async () =>
    chatSpikesPromise ? await chatSpikesPromise : null
  );
  // NOTE: on the segmented long-VOD path (windows.length > 0 above), `words`
  // only covers the chat-spike-sampled windows, not the full VOD — a keyword
  // mentioned outside those windows won't be found. Same tradeoff the
  // segmented path already makes for transcript coverage generally.
  const keywordMatchSeconds = keyword ? findKeywordMatches(words, keyword) : [];
  if (keyword) {
    console.log(`[analyze] keyword="${keyword}" matched ${keywordMatchSeconds.length} time(s) in transcript`);
  }
  const priorWindows = opts.priorWindows ?? [];
  // With a part, only that stretch was transcribed: the clip finder is told so and only keeps clips inside it.
  const observedPart = partSeconds ? [{ start: windowStart, end: durationSeconds }] : undefined;
  const poolSize = discoveryPoolSize(clipCount);
  const cacheInput = { sourceKey: opts.sourceKey ?? "", durationSeconds, contentType,
    keyword: keyword ?? "", creatorPreferences: opts.creatorPreferences ?? "",
    windows: [{ start: 0, end: durationSeconds }], pipeline: "legacy" as const, model: opts.model,
    // Results found with loud-moment hints are kept apart from older ones.
    // "trim-v1": results found before the tighter-cut rules are kept apart from new ones.
    // "relatable-v1": results found before relatable moments and the share trigger were added; "story-v1": results found before stories were looked for on purpose; "pool20": long videos look for more clips.
    signals: ["trim-v1", "story-v1", "relatable-v1", "floor40-v1", contentType === "gaming" ? "rp-v1" : "", poolSize > 10 ? "pool20" : "", loudMoments.length ? "loud-v1" : "", nonEnglish ? "lang-v1" : ""].filter(Boolean).join("+") };
  const cache = opts.client && opts.userId && opts.sourceKey
    ? createResultCache(opts.client, opts.userId, opts.sourceKey, durationSeconds, resultCacheKey(cacheInput)) : null;
  let judged = cache ? await cache.load() : null;
  let skipped = 0;
  if (judged === null) {
    const selected = await withMem("find-clips", () =>
      findClips(transcriptText, durationSeconds, chatSpikes, poolSize, contentType, keyword,
        keywordMatchSeconds, [], opts.creatorPreferences ?? "", opts.costRunId, observedPart, opts.model, loudMoments, quietStream, nonEnglish));
    judged = selected.clips;
    skipped = selected.skipped;
    await cache?.save(judged);
  }
  const schema = clipSchemaForContentType(contentType);
  if (judged.some(clip => !schema.safeParse(clip).success)) throw new Error("Cached clip candidates failed validation");
  const visualCache = cache && createResultCache(opts.client!, opts.userId!, opts.sourceKey!, durationSeconds,
    resultCacheKey({ ...cacheInput, pipeline: "legacy-visual" }));
  let readyPool = visualCache ? await visualCache.load() : null;
  let flagged: FlaggedClip<Clip>[] = [];
  if (readyPool === null) {
    const review = reviewClipBatch(trimClipBatch(judged, words), words, durationSeconds);
    flagged = review.flagged;
    readyPool = await withMem("vision-check", () =>
      validateFinalistVisuals(review.ready, uploadedPath ?? url, workDir, !!uploadedPath, opts.costRunId));
    await visualCache?.save(readyPool);
  }
  let clips = availableCachedClips(readyPool, priorWindows, clipCount);
  if (!clips.length && readyPool.length > 0 && priorWindows.length && cache) {
    const nextCache = createResultCache(opts.client!, opts.userId!, opts.sourceKey!, durationSeconds,
      resultCacheKey({ ...cacheInput, priorWindows }));
    let nextJudged = await nextCache.load();
    if (nextJudged === null) {
      const next = await withMem("find-clips-more", () =>
        findClips(transcriptText, durationSeconds, chatSpikes, poolSize, contentType, keyword,
          keywordMatchSeconds, priorWindows, opts.creatorPreferences ?? "", opts.costRunId, observedPart, opts.model, loudMoments, quietStream, nonEnglish));
      nextJudged = next.clips;
      skipped += next.skipped;
      await nextCache.save(nextJudged);
    }
    if (nextJudged.some(clip => !schema.safeParse(clip).success)) throw new Error("Cached repeat candidates failed validation");
    const nextVisualCache = createResultCache(opts.client!, opts.userId!, opts.sourceKey!, durationSeconds,
      resultCacheKey({ ...cacheInput, pipeline: "legacy-visual", priorWindows }));
    let nextReady = await nextVisualCache.load();
    if (nextReady === null) {
      const nextReview = reviewClipBatch(trimClipBatch(nextJudged, words), words, durationSeconds);
      flagged.push(...nextReview.flagged);
      nextReady = await withMem("vision-check-more", () =>
        validateFinalistVisuals(nextReview.ready, uploadedPath ?? url, workDir, !!uploadedPath, opts.costRunId));
      await nextVisualCache.save(nextReady);
    }
    clips = availableCachedClips(nextReady, priorWindows, clipCount);
  }
  for (const item of flagged) {
    console.warn(`[analyze] clip ${item.clip.start_seconds}-${item.clip.end_seconds} needs boundary review: ${item.flags.join(", ")}`);
  }
  const clipsWithWords = clips.map((clip) => ({
    ...clip,
    words: words.filter((w) => w.start >= clip.start_seconds * 1000 - 200 && w.start < clip.end_seconds * 1000),
  }));
  memSnapshot("pipeline end");

  const result = { clips: clipsWithWords, skipped, durationSeconds, transcriptChars: transcriptText.length, words,
    boundaryReview: flagged, quiet: quietStream };
  await opts.onAnalysis?.(result);
  progress("analyze", "done");
  return result;
}
