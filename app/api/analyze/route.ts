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
 * NOTE: This route spawns a yt-dlp child process, so it works in local dev /
 * on a Node server, but NOT on Vercel serverless. Video processing will move
 * to a worker service in a later stage.
 */
import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import { mkdtemp, readdir, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { AssemblyAI } from "assemblyai";
import { ClipAnalysisSchema, type AnalyzeResponse, type AnalyzeEvent, type AnalyzeStage, type TimedWord } from "@/lib/clips";
import { resolveBin, run } from "@/lib/bin";
import { findUploadedVideo } from "@/lib/video-cache";
import { getProfile, consumeSparks } from "@/lib/profile";
import { estimateSparks, MIN_ANALYZE_COST } from "@/lib/sparks";
import { detectChatSpikes, formatSpikesForPrompt, type ChatSpike } from "@/lib/twitch-chat";

export const runtime = "nodejs";
// Allow up to 5 minutes — download + transcription of a long VOD is slow.
export const maxDuration = 300;

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
  const args = [
    "-f", "bestaudio/best",
    "--no-playlist",
    "--max-filesize", "500M",
    "--ffmpeg-location", resolveBin("ffmpeg"),
    "--concurrent-fragments", "4",
    "-o", path.join(dir, "audio.%(ext)s"),
    url,
  ];

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(resolveBin("yt-dlp"), args, { windowsHide: true });
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", (err) =>
      reject(
        err.message.includes("ENOENT")
          ? new Error("yt-dlp is not installed or not on PATH. Install it with: winget install yt-dlp.yt-dlp")
          : err
      )
    );
    proc.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`yt-dlp exited with code ${code}: ${stderr.slice(-500)}`))
    );
  });

  const files = await readdir(dir);
  const audioFile = files.find((f) => f.startsWith("audio."));
  if (!audioFile) throw new Error("yt-dlp finished but no audio file was produced.");
  return path.join(dir, audioFile);
}

/* ── Stage 2 (upload flow): extract audio from an uploaded file with FFmpeg ── */
async function extractAudio(sourcePath: string, dir: string): Promise<string> {
  const outPath = path.join(dir, "audio.m4a");
  await run(resolveBin("ffmpeg"), [
    "-i", sourcePath,
    "-vn",
    "-c:a", "aac",
    "-b:a", "96k",
    "-y",
    outPath,
  ]);
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
  chatSpikes: ChatSpike[] | null
) {
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

  const spikeSection = chatSpikes
    ? `

## CHAT REPLAY SPIKES

Chat replay spikes are provided below the transcript. A spike means the live audience ERUPTED at that moment — messages-per-second jumped far above the stream's baseline. This is the strongest external engagement signal you have:

- Treat transcript moments near a spike as prime clip candidates and weight their hype dimension heavily — the live audience already voted with their keyboards.
- Read the sample messages in each spike: walls of emotes (KEKW, LULW, OMEGALUL) confirm comedy; "CLIP IT", "?????", "NO WAY" confirm shock; PogChamp/W spam confirms hype plays.
- Chat reacts a few seconds AFTER the moment — the clippable action usually starts 5-15 seconds BEFORE the spike timestamp. Anchor the clip on what caused the spike, not the spike itself.
- A spike is evidence, not a verdict: only pick the moment if the transcript supports a self-contained clip. Never clip a spike whose cause isn't visible in the transcript.
- Absence of a spike does not disqualify a moment — quiet-audience gems still clip well.`
    : "";

  const response = await client.messages.parse({
    model: "claude-opus-4-8",
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: `You are MIDAS — Klyp's Moment Identification & Analysis System.

You are the analysis brain of a professional clipping pipeline. Think of yourself as a veteran short-form editor who has cut thousands of Twitch and YouTube VODs into clips that hit millions of views on TikTok, Shorts, and Reels. Streamers pay for your judgment: you watch hours of footage so they don't have to, and you surface ONLY the moments a top human editor would fight to clip. Your picks go straight into production — precision beats volume, and a mediocre pick wastes a creator's time and money.

## YOUR INPUT

- A speech transcript of the VOD with [mm:ss] (or [h:mm:ss]) timestamps roughly every 20 seconds. Total duration: ${durationSeconds} seconds.
- Optionally, chat replay spikes — timestamps where live-chat activity exploded, with sample messages.

You cannot see the video. Reconstruct what happened on screen from the evidence in speech: gameplay callouts ("he's one shot", "behind you"), sudden screaming or dead silence, laughter, breathing, repeated phrases, tone whiplash, the streamer reading chat ("chat did you SEE that"), self-narration after a play, apologies after a fail. These are your camera.

## HOW TO ANALYZE

Read the ENTIRE transcript before selecting anything — never pick greedily from the first half. Track running storylines: bits the streamer keeps returning to, promises made early ("if I win this I'll..."), rivalries, long setups that pay off later. A callback moment scores higher when you can see the setup it pays off.

Score every candidate moment on five dimensions, 0-20 each:

1. HYPE — is the audience going wild? Chat spikes, the streamer acknowledging chat blowing up, crescendo moments, win screens, clutch reveals.
2. EMOTIONAL INTENSITY — pop-offs, screaming, genuine anger, near-tears, stunned silence, voice cracking. Raw, unperformed emotion travels furthest.
3. SKILL SHOWCASE — incredible mechanical plays, 1vX clutches, galaxy-brain strategy, speedrun-tier execution, anything that makes viewers ask "how?".
4. COMEDIC VALUE — jokes that land, absurd situations, perfect comedic timing, spectacular fails, accidental innuendo, chat-streamer banter.
5. STORYLINE SIGNIFICANCE — key plot beats of the stream: the moment the run dies, the bet gets paid, the callback lands, the arc concludes.

viral_score (1-100) is your holistic judgment informed by those dimensions — NOT their sum. A clip that maxes one dimension (a 20/20 comedic moment) beats a clip that's mediocre at everything. Also weigh: does it work with ZERO context for a viewer who has never seen this streamer? Is there a quotable line? Is it relatable outside this game's community?

Calibrate honestly. 90+ means "this could genuinely go viral" — most VODs have zero or one such moment. 75-89 is a strong clip any editor would post. 60-74 is solid filler. Below 60 should rarely appear in your top 5 unless the VOD is genuinely quiet. NEVER inflate scores to make a boring VOD look good — streamers trust the number.

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

## CLIP BOUNDARIES

- 15-60 seconds per clip: short enough for TikTok/Shorts, long enough to breathe.
- start_seconds / end_seconds must lie within the VOD duration (${durationSeconds}s) and align with the transcript timestamps.
- Pad the start a few seconds before the key line so the viewer gets setup — but never so much that the payoff arrives late. The best clips put the trigger inside the first 5 seconds.
- End on the peak: cut right after the punchline, the win, or the reaction settles. Trailing dead air kills rewatch rate.
- Each clip must be SELF-CONTAINED: someone scrolling at 2am with no context must understand it. If a moment needs a paragraph of explanation, it doesn't clip — no matter how good it felt live.

## TITLES, HOOKS, CAPTIONS

- title: short and PUNCHY, written like a top-performing TikTok caption. Use caps for EMPHASIS on the key word, an emoji where it earns its place, and concrete specifics over generic hype ("He hit the 1HP clutch and chat LOST IT 😭" beats "Insane gaming moment"). Never spoil the payoff — sell the moment, don't summarize it.
- hooks: exactly 3 alternative opening lines to overlay on the first 3 seconds of the clip. Each under 60 characters. Each takes a DIFFERENT angle — e.g. shock ("HE DID NOT JUST DO THAT"), curiosity ("wait for the last second"), challenge ("you'd have missed this shot"), stakes ("this is why chat exploded"). Every hook must open a curiosity gap that only watching closes. No hashtags in hooks.
- caption: 1-2 social-ready sentences with 2-4 relevant hashtags (game name, #clutch/#fail/#gaming-style tags, trending where genuinely fitting).
- reason: one sentence telling the streamer, editor-to-editor, why this moment earns its slot.

## THUMBNAIL FRAME

- thumbnail_seconds: the single timestamp inside the clip where the frame is most expressive — peak reaction face, the win screen, the moment of impact. This is usually at or just after the emotional peak, NOT the start of the clip.

## FINAL SELECTION

- Return the TOP 5 moments, ordered by viral_score, highest first.
- Prefer variety when scores are close: five RAGE clips from one VOD is a worse deliverable than a spread of types — but never bump a clearly stronger clip for diversity's sake.
- Do not pick overlapping or near-duplicate moments; if one moment produces two candidate windows, pick the better cut.${spikeSection}`,
    messages: [
      {
        role: "user",
        content:
          `Here is the transcript of the VOD (duration: ${durationSeconds}s). Find the 5 best clippable moments.\n\n${transcriptText}` +
          (chatSpikes ? `\n\n${formatSpikesForPrompt(chatSpikes)}` : ""),
      },
    ],
    output_config: { format: zodOutputFormat(ClipAnalysisSchema) },
  });

  if (!response.parsed_output) {
    throw new Error("Claude returned output that did not match the expected schema.");
  }
  return response.parsed_output.clips;
}

/* ── Route handler ── */
export async function POST(req: NextRequest) {
  // -- Stage 1: validate --
  let url: string;
  let uploadId: string | undefined; // set when analyzing an uploaded file instead of a URL
  let durationHint: number | undefined; // optional, from the client's cost preview — used for ETAs
  try {
    const body = await req.json();
    url = String(body.url ?? "").trim();
    const rawUploadId = String(body.uploadId ?? "").trim();
    if (rawUploadId) uploadId = rawUploadId;
    const hint = Number(body.durationHint);
    if (Number.isFinite(hint) && hint > 0) durationHint = hint;
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
  let profile;
  try {
    profile = await getProfile();
  } catch (err) {
    return fail("validate", err instanceof Error ? err.message : "Failed to load your profile.", 500);
  }
  if (!profile) {
    return fail("validate", "You must be signed in to analyze a VOD.", 401);
  }
  const upfrontCost = durationHint ? estimateSparks(durationHint) : MIN_ANALYZE_COST;
  if (profile.sparks < upfrontCost) {
    return fail(
      "validate",
      `Not enough Sparks — this analysis needs about ${upfrontCost} ⚡ but you have ${profile.sparks}. Upgrade to Pro for more.`,
      402
    );
  }

  const workDir = await mkdtemp(path.join(tmpdir(), "klyp-"));

  /*
   * Stream progress as Server-Sent Events. Each pipeline stage emits a
   * "running" event (with a rough ETA when we know the video length) and a
   * "done" event; the final payload arrives as a "result" event.
   */
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: AnalyzeEvent) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));

      let stage: AnalyzeStage = "download";
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
        const audioPath = uploadedPath
          ? await extractAudio(uploadedPath, workDir)
          : await downloadAudio(url, workDir);
        send({ type: "progress", stage: "download", status: "done" });

        // -- Stage 3: transcribe --
        stage = "transcribe";
        send({
          type: "progress", stage: "transcribe", status: "running",
          // AssemblyAI typically processes at ~4x realtime.
          etaSeconds: durationHint ? Math.max(20, Math.round(durationHint * 0.25)) : undefined,
        });
        const { words, durationSeconds } = await transcribe(audioPath);
        send({ type: "progress", stage: "transcribe", status: "done" });

        // -- Stage 4: analyze --
        stage = "analyze";
        send({
          type: "progress", stage: "analyze", status: "running",
          etaSeconds: Math.min(90, 30 + Math.round(durationSeconds / 120)),
        });
        if (!spikesPromise && !uploadedPath) {
          spikesPromise = detectChatSpikes(url, durationSeconds).catch(() => null);
        }
        const transcriptText = formatTranscript(words);
        const chatSpikes = await spikesPromise;
        const clips = await findClips(transcriptText, durationSeconds, chatSpikes);
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

        // Deduct Sparks server-side based on the measured VOD duration.
        const sparksSpent = estimateSparks(durationSeconds);
        const sparksBalance = await consumeSparks(sparksSpent);

        send({
          type: "result",
          clips: clipsWithWords,
          durationSeconds,
          transcriptChars: transcriptText.length,
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
        send({ type: "error", stage, error: message });
      } finally {
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
