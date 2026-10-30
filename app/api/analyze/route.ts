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
import { randomUUID } from "node:crypto";
import { tmpdir } from "os";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import { resolveBin, runCapture, runYtDlpCaptureWithIpv6Fallback } from "@/lib/bin";
import type { AnalyzeResponse, AnalyzeEvent, AnalyzeStage, ContentType } from "@/lib/clips";
import { CONTENT_TYPES, DEFAULT_CONTENT_TYPE } from "@/lib/clips";
import { findUploadedVideo } from "@/lib/video-cache";
import { bearerToken, getProfileFromToken, tokenClient } from "@/lib/profile-token";
import { withCors, corsPreflight } from "@/lib/cors";
import {
  estimateSparks,
  MIN_ANALYZE_COST,
  CLIP_COUNT_OPTIONS,
  CLIP_COUNT_COST,
  DEFAULT_CLIP_COUNT,
  type ClipCount,
} from "@/lib/sparks";
import { detectChatSpikes, type ChatSpike } from "@/lib/twitch-chat";
import { runAnalysisPipeline } from "@/lib/analyze-pipeline";
import { runDiscoveryPipeline } from "@/lib/vod-discovery-pipeline";
import { saveTranscript, loadJobTranscript, findReusableFullTranscript } from "@/lib/transcripts";
import { createSafeEventSender } from "@/lib/analysis-sse";
import { createOrLoadAnalysisJob, getAnalysisJob, claimAnalysisJob, checkpointAnalysisJob, failAnalysisJob, accountAnalysisJob, isAnalysisJobStale } from "@/lib/analysis-jobs";
import { runQueued } from "@/lib/job-queue";
import { acquireUserProcessingSlot } from "@/lib/clip-access";
import { userFacingAnalysisError } from "@/lib/analyze-errors";
import { anthropicCreditGate } from "@/lib/anthropic-credit";
import { vodSourceKey } from "@/lib/vod-source";
import { priorClipWindows } from "@/lib/analysis-history";
import { preferencesForToken } from "@/lib/creator-feedback-data";

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

function observeRunningJob(userId: string, jobId: string): Response {
  let disconnected = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const sender = createSafeEventSender(controller);
      sender.send({ type: "job", jobId });
      const deadline = Date.now() + 31 * 60_000;
      try {
        while (!disconnected && Date.now() < deadline) {
          const current = await getAnalysisJob(userId, jobId);
          if (current?.status === "completed" && current.result) { sender.send(current.result); break; }
          if (current?.status === "failed") { sender.send({ type: "error", stage: current.stage, error: current.error ?? "Analysis failed." }); break; }
          if (!sender.ping()) break;
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      } catch (error) {
        sender.send({ type: "error", stage: "analyze", error: error instanceof Error ? error.message : "Could not check analysis status." });
      } finally { sender.close(); }
    },
    cancel() { disconnected = true; },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } });
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
  let contentType: ContentType = DEFAULT_CONTENT_TYPE;
  let keyword: string | undefined; // optional — weights matching transcript moments higher (see lib/analyze-pipeline.ts)
  let requestedJobId: string | undefined;
  try {
    const body = await req.json();
    if (typeof body.jobId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.jobId)) requestedJobId = body.jobId;
    else if (body.jobId !== undefined) return fail("validate", "Invalid analysis job ID.", 400);
    url = String(body.url ?? "").trim();
    const rawUploadId = String(body.uploadId ?? "").trim();
    if (rawUploadId) uploadId = rawUploadId;
    const hint = Number(body.durationHint);
    if (Number.isFinite(hint) && hint > 0) durationHint = hint;
    if ((CLIP_COUNT_OPTIONS as readonly number[]).includes(Number(body.clipCount))) {
      clipCount = Number(body.clipCount) as ClipCount;
    }
    if ((CONTENT_TYPES as readonly string[]).includes(body.contentType)) {
      contentType = body.contentType as ContentType;
    }
    const rawKeyword = String(body.keyword ?? "").trim().slice(0, 100);
    if (rawKeyword) keyword = rawKeyword;
  } catch {
    return fail("validate", "Request body must be JSON: { \"url\": \"...\" } or { \"uploadId\": \"...\" }", 400);
  }

  const sourceKey = vodSourceKey(url, uploadId);
  if ((!uploadId && !VOD_URL_PATTERN.test(url)) || !sourceKey) {
    return fail("validate", "Please provide a valid YouTube video or Twitch VOD URL.", 400);
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
  const intent = { sourceKey, clipCount, contentType, keyword: keyword ?? null };
  let job;
  try {
    job = await createOrLoadAnalysisJob(profile.id, requestedJobId ?? randomUUID(), sourceKey, intent);
  } catch (error) {
    return fail("validate", error instanceof Error ? error.message : "Could not create analysis job.", 503);
  }
  const jobId = job.id;
  if (job.status === "completed" && job.result) return NextResponse.json({ jobId, ...job.result });
  if (job.status === "running" && !isAnalysisJobStale(job)) return observeRunningJob(profile.id, jobId);

  let uploadedPath: string | null = null;
  if (uploadId) {
    uploadedPath = await findUploadedVideo(uploadId);
    if (!uploadedPath) return fail("validate", "Uploaded file not found — upload your VOD again.", 400);
  }
  if (!process.env.ASSEMBLYAI_API_KEY) {
    return fail("validate", "ASSEMBLYAI_API_KEY is not set. Add it to .env.local (see README).", 500);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return fail("validate", "ANTHROPIC_API_KEY is not set. Add it to .env.local (see README).", 500);
  }
  let priorWindows;
  try {
    priorWindows = await priorClipWindows(token!, sourceKey);
  } catch (err) {
    return fail("validate", err instanceof Error ? err.message : "Could not check earlier clips.", 503);
  }
  const creatorPreferences = await preferencesForToken(token!);
  if (profile.sparks < MIN_ANALYZE_COST) {
    return fail(
      "validate",
      `Not enough Sparks — analysis starts at ${MIN_ANALYZE_COST}⚡ but you only have ${profile.sparks}⚡ remaining. Upgrade to Pro.`,
      402
    );
  }

  const releaseSlot = acquireUserProcessingSlot(profile.id);
  if (!releaseSlot) return fail("validate", "Too many requests are processing. Try again shortly.", 429);
  // The browser's duration is only a display hint. Verify the source length
  // before any paid transcription or AI call, then pass that length to the
  // pipeline so long-VOD window planning cannot rely on a shortened hint.
  let verifiedDuration: number;
  try {
    const output = await runQueued(`duration:${profile.id}`, () => uploadedPath
      ? runCapture(resolveBin("ffprobe"), ["-v", "error", "-show_entries", "format=duration",
          "-of", "default=noprint_wrappers=1:nokey=1", uploadedPath], { maxRunMs: 20_000 })
      : runYtDlpCaptureWithIpv6Fallback(["--print", "duration", "--skip-download", "--no-playlist", url]));
    verifiedDuration = Math.round(Number.parseFloat(output.trim()));
    if (!Number.isFinite(verifiedDuration) || verifiedDuration <= 0) {
      throw new Error("The VOD duration is unavailable.");
    }
  } catch (err) {
    releaseSlot();
    return fail("validate", err instanceof Error ? `Could not verify VOD duration: ${err.message}` : "Could not verify VOD duration.", 503);
  }
  if (verifiedDuration > 10 * 60 * 60) {
    releaseSlot();
    return fail("validate", "VODs over 10 hours are not supported during the limited launch.", 413);
  }
  const upfrontCost = estimateSparks(verifiedDuration) + CLIP_COUNT_COST[clipCount];
  if (profile.sparks < upfrontCost) {
    releaseSlot();
    return fail("validate", `Not enough Sparks — this will cost ${upfrontCost}⚡ but you only have ${profile.sparks}⚡ remaining. Upgrade to Pro.`, 402);
  }
  durationHint = verifiedDuration;
  let runToken: string | null;
  try { runToken = await claimAnalysisJob(job); }
  catch (error) {
    releaseSlot();
    return fail("validate", error instanceof Error ? error.message : "Could not start analysis job.", 503);
  }
  if (!runToken) {
    releaseSlot();
    return observeRunningJob(profile.id, jobId);
  }
  let workDir: string;
  try { workDir = await mkdtemp(path.join(tmpdir(), "klyp-")); }
  catch (err) {
    releaseSlot();
    await failAnalysisJob(jobId, runToken, "Could not prepare video processing.").catch(() => {});
    return fail("validate", err instanceof Error ? err.message : "Could not prepare video processing.", 500);
  }

  /*
   * Stream progress as Server-Sent Events. Each pipeline stage emits a
   * "running" event (with a rough ETA when we know the video length) and a
   * "done" event; the final payload arrives as a "result" event.
   */
  // Per-request log prefix so concurrent analyses don't interleave confusingly.
  const reqId = Math.random().toString(36).slice(2, 8);
  const log = (...args: unknown[]) =>
    console.log(`[analyze ${reqId}]`, new Date().toISOString(), ...args);
  log("start", uploadId ? `upload:${uploadId}` : url, `clips=${clipCount}`, `content=${contentType}`, `keyword=${keyword ?? "-"}`, `hint=${durationHint ?? "-"}s`);

  const stream = new ReadableStream({
    async start(controller) {
      const sender = createSafeEventSender(controller);
      const send = (event: AnalyzeEvent) => sender.send(event);
      sender.send({ type: "job", jobId });

      // SSE comment heartbeat every 10s — keeps proxies from buffering/closing
      // the idle stream and lets the client detect a dead connection.
      const heartbeat = setInterval(() => {
        sender.ping();
      }, 10_000);
      const leaseHeartbeat = setInterval(() => {
        void checkpointAnalysisJob(jobId, runToken, {}).catch((error) => log("job heartbeat failed", error));
      }, 60_000);

      let stage: AnalyzeStage = "download";
      let stageStarted = Date.now();
      const elapsed = () => `${((Date.now() - stageStarted) / 1000).toFixed(1)}s`;
      try {
        // Twitch chat spike detection runs in parallel with download+transcribe
        // (best-effort — null for YouTube, uploads, muted chat, or network failures).
        // Without a duration hint runAnalysisPipeline starts it after transcription instead.
        const useDiscoveryV2 = process.env.KLYP_DISCOVERY_V2 === "1" && !!durationHint && !!sourceKey;
        const spikesPromise: Promise<ChatSpike[] | null> | null = !useDiscoveryV2 && !uploadedPath && durationHint
          ? detectChatSpikes(url, durationHint).catch(() => null)
          : null;

        log("pipeline: started", uploadedPath ? "(upload)" : "(yt-dlp)");
        // Concurrency-capped: shares the same pool as /api/clip and
        // /api/preview, so the container never runs more than
        // MAX_CONCURRENT_JOBS yt-dlp+ffmpeg pipelines at once regardless of
        // which route they came from.
        const cachedTranscript = job.analysis_clips || useDiscoveryV2 ? null
          : await loadJobTranscript(token!, jobId) ?? await findReusableFullTranscript(token!, sourceKey);
        const pipelineResult = job.analysis_clips ? {
          clips: job.analysis_clips, skipped: 0, durationSeconds: job.analysis_duration_seconds!,
          transcriptChars: job.transcript_chars ?? 0, words: [],
        } : await runQueued(
          `analyze:${reqId}`,
          () => {
            const options = {
              uploadedPath,
              url,
              durationHint,
              clipCount,
              costRunId: jobId,
              contentType,
              keyword,
              priorWindows,
              creatorPreferences,
              workDir,
              chatSpikesPromise: spikesPromise,
              cachedTranscript: cachedTranscript ?? undefined,
              onTranscript: async ({ words, durationSeconds, coverageMode }: { words: import("@/lib/clips").TimedWord[]; durationSeconds: number; coverageMode: "full" | "chat-sampled" }) => {
                await saveTranscript(token!, { userId: profile.id, jobId, sourceKey, coverageMode,
                  url: uploadId ? `upload:${uploadId}` : url, durationSeconds, words });
                await checkpointAnalysisJob(jobId, runToken, { stage: "analyze" });
              },
              onAnalysis: async ({ clips, durationSeconds, transcriptChars }: import("@/lib/analyze-pipeline").PipelineResult) => {
                await checkpointAnalysisJob(jobId, runToken, { stage: "analyze", analysis_clips: clips,
                  analysis_duration_seconds: durationSeconds, transcript_chars: transcriptChars });
              },
              onProgress: (progressStage: AnalyzeStage, status: "running" | "done", etaSeconds?: number) => {
                if (status === "running") {
                  stage = progressStage;
                  stageStarted = Date.now();
                } else {
                  log(`${progressStage}: done in`, elapsed());
                }
                send({ type: "progress", stage: progressStage, status, etaSeconds });
                if (status === "running") void checkpointAnalysisJob(jobId, runToken, { stage: progressStage }).catch((error) => log("progress checkpoint failed", error));
              },
            };
            return useDiscoveryV2
              ? runDiscoveryPipeline({ ...options, sourceKey: sourceKey!, userId: profile.id,
                  client: tokenClient(token!), durationHint: durationHint! })
              : runAnalysisPipeline(options);
          }
        );
        const { clips: clipsWithWords, skipped, durationSeconds, transcriptChars, words } = pipelineResult;
        if (!job.analysis_clips) await checkpointAnalysisJob(jobId, runToken, { stage: "analyze",
          analysis_clips: clipsWithWords, analysis_duration_seconds: durationSeconds, transcript_chars: transcriptChars });
        log(
          "pipeline: done —",
          `${clipsWithWords.length}/${clipCount} clips${skipped > 0 ? ` (${skipped} malformed clip${skipped === 1 ? "" : "s"} skipped)` : ""}`
        );

        // Best-effort: persist the transcript for future keyword search.
        // Never blocks or fails the analysis response — the migration that
        // creates this table may not be applied yet (see migration 006).
        if (useDiscoveryV2) saveTranscript(token!, { userId: profile.id, url: uploadId ? `upload:${uploadId}` : url,
          durationSeconds, words }).catch((err) => log("transcript search copy failed (non-fatal):", err));

        // A single database transaction filters clips sold in other requests,
        // records new windows, and charges only for the accepted result.
        const result = await accountAnalysisJob(token!, jobId, runToken, clipsWithWords, durationSeconds, clipCount);
        if (result.type !== "result") throw new Error("Accounting returned an invalid result.");
        log("accounted", `${result.clips.length} new clips`, `${result.sparksSpent} Sparks`);
        send(result);
      } catch (err) {
        anthropicCreditGate.blockOn(err);
        let message = err instanceof Error ? err.message : "Pipeline failed.";
        if (err instanceof Anthropic.AuthenticationError) {
          message = "Invalid ANTHROPIC_API_KEY — check your key in .env.local.";
        } else if (err instanceof Anthropic.RateLimitError) {
          message = "Claude API rate limit hit — wait a moment and try again.";
        }
        console.error(`[analyze ${reqId}] FAILED at ${stage} after ${elapsed()}:`, err);
        const displayError = userFacingAnalysisError(stage, url, message);
        await failAnalysisJob(jobId, runToken, displayError).catch((error) => log("job failure checkpoint failed", error));
        send({ type: "error", stage, error: displayError });
      } finally {
        releaseSlot();
        clearInterval(heartbeat);
        clearInterval(leaseHeartbeat);
        rm(workDir, { recursive: true, force: true }).catch(() => {});
        sender.close();
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
