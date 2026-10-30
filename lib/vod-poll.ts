/**
 * Auto-Clipping background worker — processing service only (started from
 * instrumentation.ts, guarded by DEPLOYMENT_TARGET). Three loops:
 *
 *   1. Retry-poll: processes `pending_vod_checks` rows queued by the
 *      stream.offline EventSub webhook (app/api/twitch/eventsub). Twitch has
 *      no "VOD published" event, so this waits a few minutes then polls
 *      Get Videos, backing off until the VOD appears or attempts run out.
 *   2. Safety net: sweeps every connected, auto-clip-enabled Twitch channel
 *      on a long interval, in case a webhook delivery was ever missed.
 *
 *   3. Durable jobs: claims and processes a newly discovered VOD. The DB
 *      commits clips, Sparks, and the last-seen cursor together.
 */
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRecentVods, parseTwitchDuration } from "@/lib/twitch";
import { unseenVods } from "@/lib/vod-discovery";
import { runAnalysisPipeline } from "@/lib/analyze-pipeline";
import { runDiscoveryPipeline } from "@/lib/vod-discovery-pipeline";
import { vodSourceKey } from "@/lib/vod-source";
import { anthropicCreditGate, isAnthropicCreditBalanceError, pauseAutomaticClipping } from "@/lib/anthropic-credit";
import { preferencesForUser } from "@/lib/creator-feedback-data";
import { processClipArchiveJobs } from "@/lib/clip-archive-worker";
import { runQueued } from "@/lib/job-queue";
import { estimateSparks, clipCharge, CLIP_COUNT_COST, DEFAULT_CLIP_COUNT } from "@/lib/sparks";
import type { Profile } from "@/lib/tier";

type Admin = ReturnType<typeof createAdminClient>;
type StreamRow = {
  id: string;
  user_id: string;
  twitch_user_id: string;
  twitch_login: string | null;
  auto_clip_enabled: boolean;
  last_seen_video_id: string | null;
  created_at: string;
};

const MAX_CHECK_ATTEMPTS = 5;
const RETRY_DELAY_MS = 2 * 60_000;
const PENDING_CHECK_INTERVAL_MS = 30_000;
const SAFETY_NET_INTERVAL_MS = 3 * 60 * 60_000; // every 3 hours
const SAFETY_NET_CALL_SPACING_MS = 200; // keeps well under Twitch's 800 pts/min shared limit
const JOB_INTERVAL_MS = 30_000;

const log = (...args: unknown[]) => console.log("[vod-poll]", new Date().toISOString(), ...args);

async function notify(admin: Admin, userId: string, message: string) {
  const { error } = await admin.from("notifications").insert({ user_id: userId, message });
  if (error) log("failed to write notification", userId, error.message);
}

/**
 * Checks one stream's latest VOD against what we've already seen. If it's
 * new: enqueues a durable job. Returns whether a new VOD was found —
 * callers use this to decide whether to keep retrying (pending checks) or move on.
 */
export async function checkStreamForNewVod(admin: Admin, stream: StreamRow): Promise<"found" | "not_found"> {
  const videos = await getRecentVods(stream.twitch_user_id);
  if (videos.length === 0 || videos[0].id === stream.last_seen_video_id) return "not_found";

  // First sight of a channel: a VOD that predates the connection is a stream
  // the user finished before Klyp was watching, so clipping it would spend
  // their Sparks on something they never asked for. Record it as the baseline
  // instead. A VOD created after the connection is exactly what auto-clipping
  // is for, so it goes through even on the very first poll — the channel may
  // simply have had no VODs when it was connected.
  const predatesConnection =
    new Date(videos[0].created_at).getTime() <= new Date(stream.created_at).getTime();
  if (stream.last_seen_video_id === null && predatesConnection) {
    const { error } = await admin.from("streams").update({ last_seen_video_id: videos[0].id }).eq("id", stream.id);
    if (error) throw error;
    log("baseline set for newly connected channel", stream.id, videos[0].id);
    return "not_found";
  }

  const unseen = unseenVods(videos, stream.last_seen_video_id, stream.created_at);
  for (const video of unseen) {
    const durationSeconds = parseTwitchDuration(video.duration);
    const { error } = await admin.rpc("enqueue_auto_vod_job", {
      p_stream_id: stream.id,
      p_video_id: video.id,
      p_url: `https://www.twitch.tv/videos/${video.id}`,
      p_duration_seconds: durationSeconds,
    });
    if (error) throw error;
    log("queued VOD", stream.id, video.id);
  }
  return unseen.length ? "found" : "not_found";
}

type VodJob = {
  id: string; stream_id: string; user_id: string; video_id: string;
  url: string; duration_seconds: number; attempts: number;
};

async function processJob(admin: Admin, job: VodJob): Promise<void> {
  if (job.duration_seconds > 10 * 60 * 60) {
    // Mark the published VOD as handled so the sweep cannot keep retrying it.
    // No provider work or Sparks debit is needed for an unsupported length.
    const { data: committed, error } = await admin.rpc("finish_auto_vod_job", {
      p_job_id: job.id, p_clips: [], p_cost: 0,
    });
    if (error) throw error;
    if (committed) await notify(admin, job.user_id,
      "A new VOD was over 10 hours, so automatic clipping skipped it. Upload a shorter video to analyze it manually.");
    return;
  }
  const clipCount = DEFAULT_CLIP_COUNT;
  const upfrontCost = estimateSparks(job.duration_seconds) + CLIP_COUNT_COST[clipCount];
  const { data: profile, error: profileError } = await admin.rpc("admin_get_profile", { target_user: job.user_id });
  if (profileError || !profile) throw new Error(profileError?.message ?? "Profile not found");
  const p = profile as Profile;
  if (p.sparks < upfrontCost) {
    if (job.attempts === 1) {
      await notify(admin, job.user_id, `New VOD found — top up Sparks to auto-clip it (needs ${upfrontCost}⚡, you have ${p.sparks}⚡).`);
    }
    throw new Error(`insufficient sparks: need ${upfrontCost}, have ${p.sparks}`);
  }

  const workDir = await mkdtemp(path.join(tmpdir(), "klyp-autoclip-"));
  try {
    const creatorPreferences = await preferencesForUser(job.user_id);
    const options = {
      uploadedPath: null,
      url: job.url,
      durationHint: job.duration_seconds,
      clipCount,
      costRunId: job.id,
      workDir,
      creatorPreferences,
    };
    const result = await runQueued(`auto-vod:${job.id}`, () =>
      process.env.KLYP_DISCOVERY_V2 === "1"
        ? runDiscoveryPipeline({ ...options, sourceKey: vodSourceKey(job.url)!, userId: job.user_id,
            client: admin, durationHint: job.duration_seconds })
        : runAnalysisPipeline(options));

    const sparksSpent = estimateSparks(result.durationSeconds) + clipCharge(clipCount, result.clips.length);
    const rows = result.clips.map((clip) => ({
        title: clip.title,
        clip_type: clip.type,
        viral_score: Math.round(clip.viral_score),
        caption: clip.caption,
        reason: clip.reason,
        start_seconds: clip.start_seconds,
        end_seconds: clip.end_seconds,
        hooks: clip.hooks,
        words: clip.words,
        // Null-safe: a clip from a model response without dimensions still saves.
        dim_hype: clip.dimensions?.hype ?? null,
        dim_emotion: clip.dimensions?.emotion ?? null,
        dim_skill: clip.dimensions?.skill ?? null,
        dim_comedy: clip.dimensions?.comedy ?? null,
        dim_storyline: clip.dimensions?.storyline ?? null,
      }));
    const { data: committed, error: finishError } = await admin.rpc("finish_auto_vod_job", {
      p_job_id: job.id, p_clips: rows, p_cost: sparksSpent,
    });
    if (finishError) throw finishError;
    if (!committed) return;

    await notify(
      admin,
      job.user_id,
      `Your new VOD is clipped — ${result.clips.length} clip${result.clips.length === 1 ? "" : "s"} ready in your dashboard.`
    );
    log("auto-clipped", job.stream_id, job.video_id, `${result.clips.length} clips`, `${sparksSpent}⚡`);
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

let jobLoopRunning = false;
async function processAutoVodJobs(): Promise<void> {
  if (jobLoopRunning) return;
  jobLoopRunning = true;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("claim_auto_vod_job");
    if (error) throw error;
    const job = (data as VodJob[] | null)?.[0];
    if (!job) return;
    try {
      await processJob(admin, job);
    } catch (err) {
      const exhaustedCredits = isAnthropicCreditBalanceError(err);
      const message = exhaustedCredits ? "Anthropic API credit balance is empty" : err instanceof Error ? err.message : String(err);
      log("auto-clip FAILED", job.stream_id, job.video_id, message);
      if (exhaustedCredits) {
        anthropicCreditGate.blockOn(err);
        // One shared Anthropic key serves every stream. Stop new provider work
        // and cancel queued jobs instead of retrying after paid transcription.
        try {
          await pauseAutomaticClipping(admin);
          log("automatic clipping paused for all streams until provider credit is restored");
        } catch (pauseError) {
          log("failed to pause automatic clipping", pauseError instanceof Error ? pauseError.message : pauseError);
          const { error: failError } = await admin.rpc("fail_auto_vod_job", {
            p_job_id: job.id, p_error: message, p_retry_seconds: 86400,
          });
          if (failError) throw failError;
        }
        return;
      }
      const retrySeconds = Math.min(86400, 120 * 2 ** Math.min(job.attempts - 1, 10));
      const experimental = process.env.KLYP_DISCOVERY_V2 === "1";
      const permanent = /^insufficient sparks:|Transcript cache unavailable:|Result cache unavailable:/i.test(message);
      const { data: status, error: failError } = experimental
        ? await admin.rpc("fail_auto_vod_job_limited", {
            p_job_id: job.id, p_error: message, p_retry_seconds: retrySeconds,
            p_max_attempts: permanent ? 1 : 2,
          })
        : await admin.rpc("fail_auto_vod_job", {
            p_job_id: job.id, p_error: message, p_retry_seconds: retrySeconds,
          });
      if (failError) throw failError;
      if (status === "failed") {
        await notify(admin, job.user_id, "Auto-clipping failed for a new VOD after several attempts. You can paste the VOD link into Find Clips to analyze it manually.");
      }
    }
  } finally {
    jobLoopRunning = false;
  }
}

async function processPendingChecks(): Promise<void> {
  const admin = createAdminClient();
  const { data: due, error } = await admin
    .from("pending_vod_checks")
    .select("id, stream_id, attempts")
    .lte("check_after", new Date().toISOString())
    .lt("attempts", MAX_CHECK_ATTEMPTS)
    .limit(20);
  if (error) {
    log("failed to load pending checks", error.message);
    return;
  }

  for (const check of due ?? []) {
    const { data: stream } = await admin
      .from("streams")
      .select("id, user_id, twitch_user_id, twitch_login, auto_clip_enabled, last_seen_video_id, created_at")
      .eq("id", check.stream_id)
      .maybeSingle();

    if (!stream || !stream.twitch_user_id || !stream.auto_clip_enabled) {
      await admin.from("pending_vod_checks").delete().eq("id", check.id);
      continue;
    }

    try {
      const outcome = await checkStreamForNewVod(admin, stream as StreamRow);
      if (outcome === "found") {
        await admin.from("pending_vod_checks").delete().eq("id", check.id);
        continue;
      }
      // VOD isn't published yet — back off and retry, or give up after enough attempts.
      const attempts = check.attempts + 1;
      if (attempts >= MAX_CHECK_ATTEMPTS) {
        log("giving up — VOD never appeared", check.id, stream.twitch_login);
        await admin.from("pending_vod_checks").delete().eq("id", check.id);
      } else {
        await admin
          .from("pending_vod_checks")
          .update({ attempts, check_after: new Date(Date.now() + RETRY_DELAY_MS).toISOString() })
          .eq("id", check.id);
      }
    } catch (err) {
      log("pending check failed", check.id, err instanceof Error ? err.message : err);
    }
  }
}

/** Belt-and-suspenders sweep in case an EventSub delivery was ever missed. */
async function runSafetyNetSweep(): Promise<void> {
  const admin = createAdminClient();
  const { data: streams, error } = await admin
    .from("streams")
    .select("id, user_id, twitch_user_id, twitch_login, auto_clip_enabled, last_seen_video_id, created_at")
    .eq("platform", "twitch")
    .eq("auto_clip_enabled", true)
    .not("twitch_user_id", "is", null);
  if (error) {
    log("safety-net sweep: failed to load streams", error.message);
    return;
  }

  log("safety-net sweep starting —", (streams ?? []).length, "channels");
  for (const stream of streams ?? []) {
    try {
      await checkStreamForNewVod(admin, stream as StreamRow);
    } catch (err) {
      log("safety-net check failed", stream.id, err instanceof Error ? err.message : err);
    }
    await new Promise((r) => setTimeout(r, SAFETY_NET_CALL_SPACING_MS));
  }
}

let started = false;

/** Starts the background loops. Idempotent — safe to call more than once. */
export function startAutoClipWorker(): void {
  if (started) return;
  started = true;
  log("auto-clip worker starting");

  setInterval(() => {
    processPendingChecks().catch((err) => log("processPendingChecks crashed", err));
  }, PENDING_CHECK_INTERVAL_MS);

  setInterval(() => {
    runSafetyNetSweep().catch((err) => log("runSafetyNetSweep crashed", err));
  }, SAFETY_NET_INTERVAL_MS);

  setInterval(() => {
    processAutoVodJobs().catch((err) => log("processAutoVodJobs crashed", err));
  }, JOB_INTERVAL_MS);
  setInterval(() => {
    processClipArchiveJobs().catch((err) => log("processClipArchiveJobs crashed", err));
  }, JOB_INTERVAL_MS);

  processPendingChecks().catch((err) => log("processPendingChecks crashed", err));
  processAutoVodJobs().catch((err) => log("processAutoVodJobs crashed", err));
  processClipArchiveJobs().catch((err) => log("processClipArchiveJobs crashed", err));
}
