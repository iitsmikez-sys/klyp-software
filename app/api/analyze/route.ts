/**
 * POST /api/analyze — Klyp's clipping pipeline, stage 1 (the analysis brain).
 *
 * Pipeline:
 *   1. Validate the YouTube/Twitch VOD URL
 *   2. Download audio-only with yt-dlp (no re-encode, so ffmpeg isn't required)
 *   3. Transcribe with AssemblyAI (word-level timestamps)
 *   4. Ask Claude to find the 5 best clippable moments (structured JSON output)
 *
 * Required env vars (see .env.example):
 *   ASSEMBLYAI_API_KEY — https://www.assemblyai.com/dashboard
 *   ANTHROPIC_API_KEY  — https://platform.claude.com/settings/keys
 *
 * Required on PATH: yt-dlp (winget install yt-dlp.yt-dlp)
 *
 * NOTE: This route spawns a yt-dlp child process, so it needs to run on the
 * processing service (Railway et al.), not Vercel serverless — see
 * DEPLOYMENT_TARGET below. Auth is a Bearer token, not cookies, since this
 * service is on a different origin than the Vercel frontend that calls it.
 */
import { NextRequest, NextResponse } from "next/server";
import { mkdtemp, readdir, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { AssemblyAI } from "assemblyai";
import { ClipAnalysisSchema, ClipSchema, type Clip, type AnalyzeResponse, type AnalyzeEvent, type AnalyzeStage, type TimedWord } from "@/lib/clips";
import { resolveBin, run, runYtDlpWithRetry } from "@/lib/bin";
import { findUploadedVideo } from "@/lib/video-cache";
import { bearerToken, getProfileFromToken, consumeSparksFromToken } from "@/lib/profile-token";
import { withCors, corsPreflight } from "@/lib/cors";
import {
  estimateSparks,
  MIN_ANALYZE_COST,
  CLIP_COUNT_OPTIONS,
  CLIP_COUNT_COST,
  DEFAULT_CLIP_COUNT,
  clipCharge,
  type ClipCount,
} from "@/lib/sparks";
import { detectChatSpikes, formatSpikesForPrompt, type ChatSpike } from "@/lib/twitch-chat";

export const runtime = "nodejs";
// Allow up to 5 minutes — download + transcription of a long VOD is slow.
export const maxDuration = 300;

export const OPTIONS = corsPreflight;

const VOD_URL_PATTERN =
  /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|twitch\.tv\/videos\/|m\.twitch\.tv\/videos\/)/i;

type FailStage = Extract<AnalyzeResponse, { ok: false }>["stage"];

function fail(stage: FailStage, error: string, status = 500) {
  return NextResponse.json({ ok: false, error, stage } satisfies AnalyzeResponse, { status });
}

/* ── Stage 2: download audio with yt-dlp ── */
async function downloadAudio(url: string, dir: string): Promise<string> {
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
      "--ffmpeg-location", resolveBin("ffmpeg"),
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
async function extractAudio(sourcePath: string, dir: string): Promise<string> {
  const outPath = path.join(dir, "audio.m4a");
  await run(
    resolveBin("ffmpeg"),
    [
      "-i", sourcePath,
      "-vn",
      "-c:a", "aac",
      "-b:a", "96k",
      "-y",
      outPath,
    ],
    // ffmpeg prints progress to stderr continuously — silence means it's wedged.
    { stallTimeoutMs: 30_000, maxRunMs: 10 * 60_000 }
  );
  return outPath;
}

/* ── Stage 3: transcribe with AssemblyAI ── */
async function transcribe(audioPath: string): Promise<{ words: TimedWord[]; durationSeconds: number }> {
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
function formatTranscript(words: TimedWord[]): string {
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

/* ── Stage 4: find clippable moments with Claude ── */
async function findClips(
  transcriptText: string,
  durationSeconds: number,
  chatSpikes: ChatSpike[] | null,
  clipCount: ClipCount
) {
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

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

  const response = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: `You are MIDAS — Klyp's Moment Identification & Analysis System.

You are the analysis brain of a professional clipping pipeline. Think of yourself as a veteran short-form editor who has cut thousands of Twitch and YouTube VODs into clips that hit millions of views on TikTok, Shorts, and Reels. Streamers pay for your judgment: you watch hours of footage so they don't have to, and you surface ONLY the moments a top human editor would fight to clip. Your picks go straight into production — precision beats volume, and a mediocre pick wastes a creator's time and money.

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

viral_score (1-100) is your holistic judgment informed by those dimensions — NOT their sum. A clip that maxes one dimension (a 20/20 comedic moment) beats a clip that's mediocre at everything. Also weigh: does it work with ZERO context for a viewer who has never seen this streamer? Is there a quotable line? Is it relatable outside this game's community?

Calibrate honestly. 90+ means "this could genuinely go viral" — most VODs have zero or one such moment. 75-89 is a strong clip any editor would post. 65-74 is solid but unremarkable. Below 65 does not get returned at all (see FINAL SELECTION). NEVER inflate scores to make a boring VOD look good — streamers trust the number, and an inflated score sneaks a weak clip past the quality floor.

## THE 6 SIGNALS OF A CLIPPABLE MOMENT

Do NOT just pick moments that feel generically "interesting." Run six deliberate detection passes over the transcript — one per signal below — and collect candidates from each pass before scoring anything. Every clip you return must be triggered by at least one signal, reported in its "signals" field (most dominant first).

1. REACTION_SPIKE — a genuine, extreme reaction (shock, rage, joy, disgust) that erupts within ~2 seconds of its trigger. In transcript: sudden screaming, sentences cut off mid-word, cursing bursts, "NO WAY"/"WHAT", instant tone whiplash from calm to explosive. Delayed or performed reactions don't count.
2. CHAT_EXPLOSION — the live audience erupting: chat message-rate spiking far above the stream's baseline. Assign this signal ONLY when chat replay spike data is present in your input AND a spike aligns with the moment (chat lags the cause by 5-15 seconds — anchor on the cause). If no chat data was provided, never assign this signal.
3. UNEXPECTED_TURN — a setup followed by a twist or payoff, ideally landing 15-45 seconds after the setup: a confident claim that immediately backfires, a plan that inverts, a prediction that comes true absurdly fast. The clip must contain BOTH the setup and the payoff.
4. CONFLICT — callouts, arguments, beef between people in or around the stream: streamer vs teammate, streamer vs chat, trash talk that escalates, genuine tension. Real friction only — scripted bits belong under other signals.
5. RELATABLE_QUOTABLE — a standalone one-liner, hot take, or observation that would work as a screenshot or text post with no video. Big energy NOT required — deadpan delivery counts. Test: would this line work as a tweet?
6. CHAOS — bizarre, random, or off-topic moments unrelated to the main stream content: non-sequiturs, absurd tangents, unexplainable events, "why is this happening" energy.

Signals are your DETECTION layer; the five scoring dimensions remain your JUDGMENT layer. A moment found by any signal still has to earn its viral_score and clear the quality floor.

IMPORTANT: "signals" is its own output field, separate from "type" (next section). Signal names (REACTION_SPIKE, CHAT_EXPLOSION, UNEXPECTED_TURN, CONFLICT, RELATABLE_QUOTABLE, CHAOS) go ONLY in the signals array — never in the type field.

## CLIP TYPES

Assign each clip exactly one type — the DOMINANT flavor of the moment:

- CLUTCH — high-stakes skilled play under pressure: 1vX wins, last-second saves, impossible comebacks.
- FUNNY — comedy: jokes, bits, absurd situations, perfect timing, banter that lands.
- RAGE — anger and frustration outbursts: controller-slam energy, malding, tilted meltdowns.
- EPIC — jaw-dropping spectacle and peak hype: world-first-feeling moments, massive wins, grand payoffs that aren't primarily about mechanical skill.
- FAIL — spectacular failure: throwing a won game, embarrassing deaths, plans collapsing in the funniest or most painful way possible.
- BIG_BRAIN — outsmarting, not outshooting: 200-IQ strategy, insane predictions, galaxy-brain outplays, "he KNEW" moments.
- EMOTIONAL — genuine feeling: heartfelt reactions, near-tears, gratitude to chat, vulnerable or wholesome moments.
- SUS — out-of-pocket moments: accidental innuendo, things said that should NOT have been said, "clip that out of context" material.

If a moment is both funny and a fail, ask: would TikTok caption this as a fail or as a joke? Pick that one.

"type" and "signals" are DIFFERENT fields with DISJOINT vocabularies — never mix them:
- type: exactly ONE of the 8 clip types above (CLUTCH, FUNNY, RAGE, EPIC, FAIL, BIG_BRAIN, EMOTIONAL, SUS). NEVER a signal name.
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
- Do not pick overlapping or near-duplicate moments; if one moment produces two candidate windows, pick the better cut.${spikeSection}`,
    messages: [
      {
        role: "user",
        content:
          `Here is the transcript of the VOD (duration: ${durationSeconds}s). Find up to ${clipCount} clippable moments that clear the quality floor.\n\n${transcriptText}` +
          (chatSpikes ? `\n\n${formatSpikesForPrompt(chatSpikes)}` : ""),
      },
    ],
    output_config: { format: zodOutputFormat(ClipAnalysisSchema) },
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
    throw new Error("Claude returned output that was not valid JSON.");
  }
  const rawClips = (parsed as { clips?: unknown }).clips;
  if (!Array.isArray(rawClips)) {
    throw new Error("Claude returned output that did not match the expected schema.");
  }

  const clips: Clip[] = [];
  let skipped = 0;
  for (const raw of rawClips) {
    const result = ClipSchema.safeParse(raw);
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

  return { clips, skipped };
}

/* ── Route handler ── */
export async function POST(req: NextRequest): Promise<Response> {
  return withCors(await handlePOST(req));
}

async function handlePOST(req: NextRequest): Promise<Response> {
  // This route only runs on the processing service — set DEPLOYMENT_TARGET
  // there (and in local dev's .env.local, where one server plays both roles).
  if (process.env.DEPLOYMENT_TARGET !== "processing") {
    return NextResponse.json({ error: "This endpoint only runs on the processing service." }, { status: 404 });
  }

  // -- Stage 1: validate --
  let url: string;
  let uploadId: string | undefined; // set when analyzing an uploaded file instead of a URL
  let durationHint: number | undefined; // optional, from the client's cost preview — used for ETAs
  let clipCount: ClipCount = DEFAULT_CLIP_COUNT;
  try {
    const body = await req.json();
    url = String(body.url ?? "").trim();
    const rawUploadId = String(body.uploadId ?? "").trim();
    if (rawUploadId) uploadId = rawUploadId;
    const hint = Number(body.durationHint);
    if (Number.isFinite(hint) && hint > 0) durationHint = hint;
    if ((CLIP_COUNT_OPTIONS as readonly number[]).includes(Number(body.clipCount))) {
      clipCount = Number(body.clipCount) as ClipCount;
    }
  } catch {
    return fail("validate", "Request body must be JSON: { \"url\": \"...\" } or { \"uploadId\": \"...\" }", 400);
  }

  if (!uploadId && !VOD_URL_PATTERN.test(url)) {
    return fail("validate", "Please provide a valid YouTube video or Twitch VOD URL.", 400);
  }

  let uploadedPath: string | null = null;
  if (uploadId) {
    uploadedPath = await findUploadedVideo(uploadId);
    if (!uploadedPath) {
      return fail("validate", "Uploaded file not found — upload your VOD again.", 400);
    }
  }
  if (!process.env.ASSEMBLYAI_API_KEY) {
    return fail("validate", "ASSEMBLYAI_API_KEY is not set. Add it to .env.local (see README).", 500);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return fail("validate", "ANTHROPIC_API_KEY is not set. Add it to .env.local (see README).", 500);
  }

  // -- Sparks gate: must be logged in with enough balance for the cheapest analysis --
  // Verified via Bearer token, not cookies — this service is on a different
  // origin than the frontend that calls it.
  const token = bearerToken(req);
  let profile;
  try {
    profile = token ? await getProfileFromToken(token) : null;
  } catch (err) {
    return fail("validate", err instanceof Error ? err.message : "Failed to load your profile.", 500);
  }
  if (!profile) {
    return fail("validate", "You must be signed in to analyze a VOD.", 401);
  }
  const upfrontCost = durationHint
    ? estimateSparks(durationHint) + CLIP_COUNT_COST[clipCount]
    : MIN_ANALYZE_COST;
  if (profile.sparks < upfrontCost) {
    return fail(
      "validate",
      `Not enough Sparks — this will cost ${upfrontCost}⚡ but you only have ${profile.sparks}⚡ remaining. Upgrade to Pro.`,
      402
    );
  }

  const workDir = await mkdtemp(path.join(tmpdir(), "klyp-"));

  /*
   * Stream progress as Server-Sent Events. Each pipeline stage emits a
   * "running" event (with a rough ETA when we know the video length) and a
   * "done" event; the final payload arrives as a "result" event.
   */
  // Per-request log prefix so concurrent analyses don't interleave confusingly.
  const reqId = Math.random().toString(36).slice(2, 8);
  const log = (...args: unknown[]) =>
    console.log(`[analyze ${reqId}]`, new Date().toISOString(), ...args);
  log("start", uploadId ? `upload:${uploadId}` : url, `clips=${clipCount}`, `hint=${durationHint ?? "-"}s`);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: AnalyzeEvent) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));

      // SSE comment heartbeat every 10s — keeps proxies from buffering/closing
      // the idle stream and lets the client detect a dead connection.
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          clearInterval(heartbeat);
        }
      }, 10_000);

      let stage: AnalyzeStage = "download";
      let stageStarted = Date.now();
      const elapsed = () => `${((Date.now() - stageStarted) / 1000).toFixed(1)}s`;
      try {
        // Twitch chat spike detection runs in parallel with download+transcribe
        // (best-effort — null for YouTube, uploads, muted chat, or network failures).
        // Without a duration hint we start it after transcription instead.
        let spikesPromise: Promise<ChatSpike[] | null> | null = !uploadedPath && durationHint
          ? detectChatSpikes(url, durationHint).catch(() => null)
          : null;

        // -- Stage 2: download (URL) or audio extraction (uploaded file) --
        send({
          type: "progress", stage: "download", status: "running",
          // Audio-only downloads / extraction run far faster than realtime.
          etaSeconds: durationHint ? Math.max(10, Math.round(durationHint / 60)) : undefined,
        });
        log("download: started", uploadedPath ? "(extract from upload)" : "(yt-dlp)");
        const audioPath = uploadedPath
          ? await extractAudio(uploadedPath, workDir)
          : await downloadAudio(url, workDir);
        log("download: done in", elapsed(), "→", path.basename(audioPath));
        send({ type: "progress", stage: "download", status: "done" });

        // -- Stage 3: transcribe --
        stage = "transcribe";
        stageStarted = Date.now();
        send({
          type: "progress", stage: "transcribe", status: "running",
          // AssemblyAI typically processes at ~4x realtime.
          etaSeconds: durationHint ? Math.max(20, Math.round(durationHint * 0.25)) : undefined,
        });
        const { words, durationSeconds } = await transcribe(audioPath);
        log("transcribe: done in", elapsed(), `— ${words.length} words, VOD ${durationSeconds}s`);
        send({ type: "progress", stage: "transcribe", status: "done" });

        // -- Stage 4: analyze --
        stage = "analyze";
        stageStarted = Date.now();
        send({
          type: "progress", stage: "analyze", status: "running",
          etaSeconds: Math.min(90, 30 + Math.round(durationSeconds / 120)),
        });
        if (!spikesPromise && !uploadedPath) {
          spikesPromise = detectChatSpikes(url, durationSeconds).catch(() => null);
        }
        const transcriptText = formatTranscript(words);
        const chatSpikes = await spikesPromise;
        const { clips, skipped } = await findClips(transcriptText, durationSeconds, chatSpikes, clipCount);
        log(
          "analyze: done in", elapsed(),
          `— ${clips.length}/${clipCount} clips${skipped > 0 ? ` (${skipped} malformed clip${skipped === 1 ? "" : "s"} skipped)` : ""}`
        );
        send({ type: "progress", stage: "analyze", status: "done" });

        // Attach per-clip word arrays so the client can burn captions without
        // a second trip. Filter: words that start within the clip window (±200ms).
        const clipsWithWords = clips.map((clip) => ({
          ...clip,
          words: words.filter(
            (w) =>
              w.start >= clip.start_seconds * 1000 - 200 &&
              w.start < clip.end_seconds * 1000
          ),
        }));

        // Deduct Sparks server-side: VOD length cost + clip cost prorated by
        // how many clips actually cleared the quality floor.
        const sparksSpent = estimateSparks(durationSeconds) + clipCharge(clipCount, clips.length);
        const sparksBalance = await consumeSparksFromToken(token!, sparksSpent);

        send({
          type: "result",
          clips: clipsWithWords,
          durationSeconds,
          transcriptChars: transcriptText.length,
          requestedClips: clipCount,
          sparksSpent,
          sparksBalance,
        });
      } catch (err) {
        let message = err instanceof Error ? err.message : "Pipeline failed.";
        if (err instanceof Anthropic.AuthenticationError) {
          message = "Invalid ANTHROPIC_API_KEY — check your key in .env.local.";
        } else if (err instanceof Anthropic.RateLimitError) {
          message = "Claude API rate limit hit — wait a moment and try again.";
        }
        console.error(`[analyze ${reqId}] FAILED at ${stage} after ${elapsed()}:`, err);
        send({ type: "error", stage, error: message });
      } finally {
        clearInterval(heartbeat);
        rm(workDir, { recursive: true, force: true }).catch(() => {});
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
