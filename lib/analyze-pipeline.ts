/**
 * Core VOD analysis pipeline (download/extract → transcribe → find clips) —
 * shared between the interactive SSE route (app/api/analyze/route.ts) and the
 * auto-clip background worker (lib/vod-poll.ts), which has no browser
 * listening for progress events and no per-request user Bearer token.
 *
 * Auth, Sparks charging, SSE streaming, and Supabase persistence are each
 * caller's responsibility — this module only runs the actual pipeline.
 */
import { readdir } from "fs/promises";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
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
import { ffmpegLocationArgs, resolveBin, run, runYtDlpWithRetry, ytDlpThreadCapArgs, FFMPEG_THREADS } from "@/lib/bin";
import {
  type ChatSpike,
  type AudioWindow,
  formatSpikesForPrompt,
  detectChatSpikes,
  twitchVideoId,
  spikeWindows,
} from "@/lib/twitch-chat";
import { type ClipCount } from "@/lib/sparks";

/* ── Stage 2: download audio with yt-dlp ── */
export async function downloadAudio(url: string, dir: string): Promise<string> {
  // Audio_Only on Twitch / bestaudio elsewhere — all HLS (m3u8) streams need
  // ffmpeg to merge segments. --ffmpeg-location avoids the stale-PATH hang.
  // Retries once on YouTube's transient 403/429 throttling (see runYtDlpWithRetry).
  // --socket-timeout makes yt-dlp bail on a dead connection instead of blocking
  // forever; stallTimeoutMs/maxRunMs kill the process if it wedges anyway.
  await runYtDlpWithRetry(
    [
      "-f", "bestaudio/best",
      "--no-playlist",
      "--max-filesize", "500M",
      "--socket-timeout", "30",
      "--retries", "3",
      "--fragment-retries", "5",
      ...ffmpegLocationArgs(),
      ...ytDlpThreadCapArgs(),
      "--concurrent-fragments", "4",
      "-o", path.join(dir, "audio.%(ext)s"),
      url,
    ],
    { stallTimeoutMs: 60_000, maxRunMs: 10 * 60_000 }
  );

  const files = await readdir(dir);
  const audioFile = files.find((f) => f.startsWith("audio."));
  if (!audioFile) throw new Error("yt-dlp finished but no audio file was produced.");
  return path.join(dir, audioFile);
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

/* ── Segmented audio for long Twitch VODs ──────────────────────────
 * Full-VOD audio is ~216kbps, so a 10.9h stream is ~1GB and roughly five
 * minutes of download before transcription even starts — and AssemblyAI then
 * bills and chews through all 10.9 hours. For long Twitch VODs we already
 * know where the interesting moments are (chat spikes), so we fetch only
 * windows around them: ~20 × 60s ≈ 32MB instead of 1GB.
 *
 * Deliberately NOT used for YouTube or uploaded files: detectChatSpikes()
 * returns null for anything that isn't a twitch.tv/videos/ URL, so there
 * would be no candidate windows and the analysis would find nothing. Those
 * keep the full-transcript path.
 */

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
async function transcribeWindows(paths: string[], windows: AudioWindow[]): Promise<TimedWord[]> {
  const perWindow = await mapWithConcurrency(paths, SEGMENT_CONCURRENCY, async (audioPath, i) => {
    const offsetMs = windows[i].start * 1000;
    try {
      const { words } = await transcribe(audioPath);
      return words.map((w) => ({ ...w, start: w.start + offsetMs, end: w.end + offsetMs }));
    } catch (err) {
      // A silent window (transcribe throws on zero words) must not sink the
      // whole analysis — the other windows still carry the good moments.
      console.warn(`[analyze] window ${windows[i].start}-${windows[i].end}s produced no transcript:`, err);
      return [] as TimedWord[];
    }
  });
  return perWindow.flat().sort((a, b) => a.start - b.start);
}

/* ── Stage 3: transcribe with AssemblyAI ── */
export async function transcribe(audioPath: string): Promise<{ words: TimedWord[]; durationSeconds: number }> {
  const aai = new AssemblyAI({ apiKey: process.env.ASSEMBLYAI_API_KEY! });

  // The SDK uploads the local file and polls until the transcript is ready.
  const transcript = await aai.transcripts.transcribe({ audio: audioPath });

  if (transcript.status === "error") {
    throw new Error(`AssemblyAI transcription failed: ${transcript.error}`);
  }
  if (!transcript.words || transcript.words.length === 0) {
    throw new Error("Transcription returned no words — the VOD may have no speech.");
  }

  return {
    words: transcript.words.map((w) => ({ text: w.text, start: w.start, end: w.end })),
    durationSeconds: Math.round((transcript.audio_duration ?? 0) || transcript.words.at(-1)!.end / 1000),
  };
}

/**
 * Format word-level timestamps into [mm:ss]-prefixed blocks (~20s each) so
 * Claude can reference precise times without us sending one line per word.
 */
export function formatTranscript(words: TimedWord[]): string {
  const BLOCK_MS = 20_000;
  const lines: string[] = [];
  let blockStart = 0;
  let current: string[] = [];

  const stamp = (ms: number) => {
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h > 0
      ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      : `${m}:${String(s).padStart(2, "0")}`;
  };

  for (const w of words) {
    if (w.start >= blockStart + BLOCK_MS && current.length > 0) {
      lines.push(`[${stamp(blockStart)}] ${current.join(" ")}`);
      current = [];
      blockStart = Math.floor(w.start / BLOCK_MS) * BLOCK_MS;
    }
    current.push(w.text);
  }
  if (current.length > 0) lines.push(`[${stamp(blockStart)}] ${current.join(" ")}`);
  return lines.join("\n");
}

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
  priorWindows: { start_seconds: number; end_seconds: number }[] = []
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
  const priorSection = priorWindows.length
    ? `\n\n## MOMENTS ALREADY DELIVERED TO THIS USER\n\nThese time ranges were already sold from this VOD. Find the next best genuinely different moments outside these ranges. Do not return a clip within 60 seconds of any listed start or overlapping a listed range. If no other moment clears the quality floor, return an empty clips array.\n${priorWindows.map((w) => `- ${Math.round(w.start_seconds)}s to ${Math.round(w.end_seconds)}s`).join("\n")}`
    : "";

  const { data: response, response: rawResponse } = await client.messages.create({
    model: "claude-opus-4-8",
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

viral_score (1-100) is your holistic judgment informed by those dimensions — NOT their sum. A clip that maxes one dimension (a 20/20 comedic moment) beats a clip that's mediocre at everything. Also weigh: does it work with ZERO context for a viewer who has never seen this streamer? Is there a quotable line? Is it relatable outside this game's community?

Calibrate honestly. 90+ means "this could genuinely go viral" — most VODs have zero or one such moment. 75-89 is a strong clip any editor would post. 65-74 is solid but unremarkable. Below 65 does not get returned at all (see FINAL SELECTION). NEVER inflate scores to make a boring VOD look good — streamers trust the number, and an inflated score sneaks a weak clip past the quality floor.

## THE 6 SIGNALS OF A CLIPPABLE MOMENT

Do NOT just pick moments that feel generically "interesting." Run six deliberate detection passes over the transcript — one per signal below, in this priority order — and collect candidates from each pass before scoring anything. When two candidates are otherwise comparable, prefer the one triggered by the higher-priority signal. Every clip you return must be triggered by at least one signal, reported in its "signals" field (most dominant first).

1. UNEXPECTED_TURN — a setup followed by a twist or payoff, ideally landing 15-45 seconds after the setup: a confident claim that immediately backfires, a plan that inverts, a prediction that comes true absurdly fast. The clip must contain BOTH the setup and the payoff — a setup with no payoff isn't a clip, it's dead air; do not select it.
2. REACTION_SPIKE — a genuine, extreme reaction (shock, laughter, rage, disgust) that erupts within ~2 seconds of its trigger. In transcript: sudden screaming, sentences cut off mid-word, cursing bursts, laughter breaking through speech, "NO WAY"/"WHAT", instant tone whiplash from calm to explosive. Delayed or performed reactions don't count.
3. RELATABLE_QUOTABLE — a standalone one-liner, hot take, or observation that would work as a screenshot or text post with no video, roughly under 10 words. Big energy NOT required — deadpan delivery counts. Test: would this line work as a tweet?
4. CHAT_EXPLOSION — the live audience erupting: chat message-rate spiking far above the stream's baseline. Assign this signal ONLY when chat replay spike data is present in your input AND a spike aligns with the moment (chat lags the cause by 5-15 seconds — anchor on the cause). If no chat data was provided, never assign this signal.
5. CONFLICT — callouts, arguments, beef between people in or around the stream: streamer vs teammate, streamer vs chat, trash talk that escalates, genuine tension. Weight it higher when the tension resolves in a way nobody saw coming (an apology that lands sideways, the argument flipping into laughter, a comeback that ends it cold) rather than fizzling out or resolving exactly as expected. Real friction only — scripted bits belong under other signals.
6. CHAOS — bizarre, random, or off-topic moments unrelated to the main stream content: non-sequiturs, absurd tangents, unexplainable events, "why is this happening" energy.

DEPRIORITIZE — these rarely make good clips even when nothing about them is technically wrong:
- Slow builds: a moment that needs a long runway to get anywhere. If the payoff doesn't land within roughly the first 45 seconds, it's a weak candidate no matter what happens after.
- Setup without payoff: a promising claim, bet, or buildup that the transcript never resolves. Half a moment is not a moment — this is UNEXPECTED_TURN's own rule above, generalized to every signal.
- Anything that would only work by stretching past ~90 seconds. The 15-60s boundary below already enforces a hard cap tighter than this — don't reach for a marginal moment that only makes sense if you imagine a longer window than you're allowed to cut.
- Calm, low-energy talking with no reaction, tension, or punchline. A streamer explaining something clearly but flatly, in a level conversational tone, is not a clip — it never goes viral no matter how interesting the content is. If nothing in the signal list above actually fires on a moment, that absence is usually exactly this: skip it. Never select a moment on vibes alone; every clip needs a real, identifiable trigger.

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

- 15-60 seconds per clip: short enough for TikTok/Shorts, long enough to breathe.
- start_seconds / end_seconds must lie within the VOD duration (${durationSeconds}s) and align with the transcript timestamps.
- Pad the start a few seconds before the key line so the viewer gets setup — but never so much that the payoff arrives late. The best clips put the trigger inside the first 5 seconds.
- End on the peak: cut right after the punchline, the win, or the reaction settles. Trailing dead air kills rewatch rate.
- Each clip must be SELF-CONTAINED: someone scrolling at 2am with no context must understand it. If a moment needs a paragraph of explanation, it doesn't clip — no matter how good it felt live.

## TITLES, HOOKS, CAPTIONS

- title: short and PUNCHY, written like a top-performing TikTok caption. Use caps for EMPHASIS on the key word, an emoji where it earns its place, and concrete specifics over generic hype ("He hit the 1HP clutch and chat LOST IT 😭" beats "Insane gaming moment"). Never spoil the payoff — sell the moment, don't summarize it.
- hooks: exactly 3 alternative on-screen hook lines, burned over the first 3 seconds of the clip in big meme-caption text. Write them as REACTION/CALLOUT statements about the moment — the style a clips channel would slap on screen: "RAKAI CRASHED OUT", "HE ONE-SHOT THE FINAL BOSS", "CHAT MADE HIM RAGE QUIT". HARD LIMIT: under 8 words each. Punchy callouts, not sentences — no hashtags, no trailing punctuation. Each of the 3 takes a DIFFERENT angle on the same moment (the reaction, the stakes, the absurdity). They render in ALL CAPS on screen, so write text that works uppercased.
- caption: 1-2 social-ready sentences with 2-4 relevant hashtags (game name, #clutch/#fail/#gaming-style tags, trending where genuinely fitting).
- reason: one sentence telling the streamer, editor-to-editor, why this moment earns its slot.

## THUMBNAIL FRAME

- thumbnail_seconds: the single timestamp inside the clip where the frame is most expressive — peak reaction face, the win screen, the moment of impact. This is usually at or just after the emotional peak, NOT the start of the clip.

## FINAL SELECTION

- From your full Phase 1 candidate pool, return the TOP ${clipCount} by viral_score, highest first — never the first ${clipCount} you happened to find while scanning. A late-VOD 88 always beats an early-VOD 74, full stop.
- QUALITY FLOOR: include a clip ONLY if its viral_score is 65 or higher. If the VOD has just 3 genuinely great moments, return 3 — NEVER pad the list with filler to hit the count. The streamer is charged per clip returned; a weak clip costs them money and trust.
- Prefer variety ONLY as a tiebreaker between near-identical scores (within ~2 points): a wall of RAGE clips from one VOD is a worse deliverable than a spread of types. Variety is NEVER a reason to drop a higher-scoring moment for a lower-scoring one — score ranking always wins.
- Do not pick overlapping or near-duplicate moments; if one moment produces two candidate windows, pick the better cut.${spikeSection}${keywordSection}`,
    messages: [
      {
        role: "user",
        content:
      `Here is the transcript of the VOD (duration: ${durationSeconds}s). Find up to ${clipCount} clippable moments that clear the quality floor.\n\n${transcriptText}${priorSection}` +
          (chatSpikes ? `\n\n${formatSpikesForPrompt(chatSpikes)}` : ""),
      },
    ],
    output_config: { format: zodOutputFormat(clipAnalysisSchemaForContentType(contentType)) },
  }).withResponse();

  logAnthropicRateLimits(rawResponse.headers, "findClips");

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
    throw new Error("Claude returned output that was not valid JSON.");
  }
  const rawClips = (parsed as { clips?: unknown }).clips;
  if (!Array.isArray(rawClips)) {
    throw new Error("Claude returned output that did not match the expected schema.");
  }

  const clipSchema = clipSchemaForContentType(contentType);
  const clips: Clip[] = [];
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

  // Safety net: the prompt asks Claude to return clips ranked by viral_score
  // descending, but model compliance isn't guaranteed — always re-sort here so
  // the final output order is correct regardless of what order Claude used.
  clips.sort((a, b) => b.viral_score - a.viral_score);

  // Safety net #2: the prompt also asks Claude not to return overlapping or
  // near-duplicate moments, but it sometimes returns several clips anchored
  // within seconds of each other (e.g. 4 clips all starting around 2:40:40).
  // Greedily keep the highest-scoring clip in each 60s start-time window and
  // drop the rest — clips is already sorted by viral_score descending, so the
  // first clip claiming a window is always its best one.
  const DEDUPE_WINDOW_S = 60;
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
  clips.push(...deduped.slice(0, clipCount));

  console.log(
    `[analyze] content=${contentType} types:`,
    clips.map((c) => c.type).join(", ") || "(none)"
  );

  return { clips, skipped };
}

export type PipelineProgress = (stage: AnalyzeStage, status: "running" | "done", etaSeconds?: number) => void;

export type PipelineResult = {
  clips: (Clip & { words: TimedWord[] })[];
  skipped: number;
  durationSeconds: number;
  transcriptChars: number;
  /** Full VOD-level word transcript — returned so the caller can persist it
   *  (see lib/transcripts.ts). Not scoped to any single clip. */
  words: TimedWord[];
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
  chatSpikesPromise?: Promise<ChatSpike[] | null> | null;
  onProgress?: PipelineProgress;
}): Promise<PipelineResult> {
  const { uploadedPath, url, durationHint, clipCount, workDir, onProgress } = opts;
  const contentType = opts.contentType ?? DEFAULT_CONTENT_TYPE;
  const keyword = opts.keyword;
  const progress: PipelineProgress = onProgress ?? (() => {});

  memSnapshot("pipeline start");

  // Long Twitch VODs: fetch audio only around chat spikes instead of the whole
  // stream. Needs the spikes BEFORE downloading, so resolve them up front —
  // they're cheap (sampled GQL pages) and reused for the prompt later.
  const canSegment =
    !uploadedPath &&
    !!durationHint &&
    durationHint >= SEGMENT_MIN_VOD_S &&
    twitchVideoId(url) !== null;
  let spikesForPlan: ChatSpike[] | null = null;
  if (canSegment) {
    spikesForPlan = await (
      opts.chatSpikesPromise ?? detectChatSpikes(url, durationHint!).catch(() => null)
    );
  }
  const windows =
    canSegment && spikesForPlan?.length ? spikeWindows(spikesForPlan, durationHint!) : [];

  progress("download", "running", durationHint ? Math.max(10, Math.round(durationHint / 60)) : undefined);
  let words: TimedWord[];
  let durationSeconds: number;

  if (windows.length > 0) {
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
    words = await withMem("transcribe", () => transcribeWindows(paths, windows));
    if (words.length === 0) {
      throw new Error("Transcription returned no words — the VOD may have no speech.");
    }
    // The VOD's real length, not the sampled total: clip bounds and the prompt
    // both reason about positions in the original stream.
    durationSeconds = Math.round(durationHint!);
  } else {
    const audioPath = await withMem("download", () =>
      uploadedPath ? extractAudio(uploadedPath, workDir) : downloadAudio(url, workDir)
    );
    progress("download", "done");

    progress("transcribe", "running", durationHint ? Math.max(20, Math.round(durationHint * 0.25)) : undefined);
    const result = await withMem("transcribe", () => transcribe(audioPath));
    words = result.words;
    durationSeconds = result.durationSeconds;
  }
  console.log(`[mem] transcribe produced ${words.length} words`);
  progress("transcribe", "done");

  progress("analyze", "running", Math.min(90, 30 + Math.round(durationSeconds / 120)));
  let chatSpikesPromise = opts.chatSpikesPromise;
  if (spikesForPlan) {
    chatSpikesPromise = Promise.resolve(spikesForPlan); // already resolved above
  } else if (!chatSpikesPromise && !uploadedPath) {
    chatSpikesPromise = detectChatSpikes(url, durationSeconds).catch(() => null);
  }
  const transcriptText = await withMem("format-transcript", async () => formatTranscript(words));
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
  const { clips, skipped } = await withMem("find-clips", () =>
    findClips(transcriptText, durationSeconds, chatSpikes, clipCount, contentType, keyword, keywordMatchSeconds, opts.priorWindows ?? [])
  );
  progress("analyze", "done");

  const clipsWithWords = clips.map((clip) => ({
    ...clip,
    words: words.filter((w) => w.start >= clip.start_seconds * 1000 - 200 && w.start < clip.end_seconds * 1000),
  }));
  memSnapshot("pipeline end");

  return { clips: clipsWithWords, skipped, durationSeconds, transcriptChars: transcriptText.length, words };
}
