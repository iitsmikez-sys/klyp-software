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
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import type { AnalyzeResponse, AnalyzeEvent, AnalyzeStage } from "@/lib/clips";
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
import { detectChatSpikes, type ChatSpike } from "@/lib/twitch-chat";
import { runAnalysisPipeline } from "@/lib/analyze-pipeline";

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
        // Without a duration hint runAnalysisPipeline starts it after transcription instead.
        const spikesPromise: Promise<ChatSpike[] | null> | null = !uploadedPath && durationHint
          ? detectChatSpikes(url, durationHint).catch(() => null)
          : null;

        log("pipeline: started", uploadedPath ? "(upload)" : "(yt-dlp)");
        const { clips: clipsWithWords, skipped, durationSeconds, transcriptChars } = await runAnalysisPipeline({
          uploadedPath,
          url,
          durationHint,
          clipCount,
          workDir,
          chatSpikesPromise: spikesPromise,
          onProgress: (progressStage, status, etaSeconds) => {
            if (status === "running") {
              stage = progressStage;
              stageStarted = Date.now();
            } else {
              log(`${progressStage}: done in`, elapsed());
            }
            send({ type: "progress", stage: progressStage, status, etaSeconds });
          },
        });
        log(
          "pipeline: done —",
          `${clipsWithWords.length}/${clipCount} clips${skipped > 0 ? ` (${skipped} malformed clip${skipped === 1 ? "" : "s"} skipped)` : ""}`
        );

        // Deduct Sparks server-side: VOD length cost + clip cost prorated by
        // how many clips actually cleared the quality floor.
        const sparksSpent = estimateSparks(durationSeconds) + clipCharge(clipCount, clipsWithWords.length);
        const sparksBalance = await consumeSparksFromToken(token!, sparksSpent);

        send({
          type: "result",
          clips: clipsWithWords,
          durationSeconds,
          transcriptChars,
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
