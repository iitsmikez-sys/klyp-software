/**
 * Auto-Clipping background worker — processing service only (started from
 * instrumentation.ts, guarded by DEPLOYMENT_TARGET). Two loops:
 *
 *   1. Retry-poll: processes `pending_vod_checks` rows queued by the
 *      stream.offline EventSub webhook (app/api/twitch/eventsub). Twitch has
 *      no "VOD published" event, so this waits a few minutes then polls
 *      Get Videos, backing off until the VOD appears or attempts run out.
 *   2. Safety net: sweeps every connected, auto-clip-enabled Twitch channel
 *      on a long interval, in case a webhook delivery was ever missed.
 *
 * Low-Sparks handling is skip+notify, not queue+retry: if a user can't afford
 * the newly-found VOD right now, we notify them and move on. They can always
 * run it manually later from the dashboard — no pending state to hold.
 */
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { createAdminClient } from "@/lib/supabase/admin";
import { getLatestVod, parseTwitchDuration } from "@/lib/twitch";
import { runAnalysisPipeline } from "@/lib/analyze-pipeline";
import { estimateSparks, clipCharge, CLIP_COUNT_COST, DEFAULT_CLIP_COUNT } from "@/lib/sparks";
import type { Profile } from "@/lib/tier";

type Admin = ReturnType<typeof createAdminClient>;
type StreamRow = {
  id: string;
  user_id: string;
  twitch_user_id: string;
  twitch_login: string | null;
  last_seen_video_id: string | null;
};

const MAX_CHECK_ATTEMPTS = 5;
const RETRY_DELAY_MS = 2 * 60_000;
const PENDING_CHECK_INTERVAL_MS = 30_000;
const SAFETY_NET_INTERVAL_MS = 3 * 60 * 60_000; // every 3 hours
const SAFETY_NET_CALL_SPACING_MS = 200; // keeps well under Twitch's 800 pts/min shared limit

const log = (...args: unknown[]) => console.log("[vod-poll]", new Date().toISOString(), ...args);

async function notify(admin: Admin, userId: string, message: string) {
  const { error } = await admin.from("notifications").insert({ user_id: userId, message });
  if (error) log("failed to write notification", userId, error.message);
}

/**
 * Checks one stream's latest VOD against what we've already seen. If it's
 * new: advances last_seen_video_id immediately (before any Sparks/pipeline
 * work) so a crash or a low-Sparks skip never causes a duplicate notification
 * or re-processing on the next pass. Returns whether a new VOD was found —
 * callers use this to decide whether to keep retrying (pending checks) or move on.
 */
export async function checkStreamForNewVod(admin: Admin, stream: StreamRow): Promise<"found" | "not_found"> {
  const video = await getLatestVod(stream.twitch_user_id);
  if (!video || video.id === stream.last_seen_video_id) return "not_found";

  await admin.from("streams").update({ last_seen_video_id: video.id }).eq("id", stream.id);

  const channelLabel = stream.twitch_login ?? "your channel";
  const durationSeconds = parseTwitchDuration(video.duration);
  const clipCount = DEFAULT_CLIP_COUNT;
  const upfrontCost = estimateSparks(durationSeconds) + CLIP_COUNT_COST[clipCount];

  const { data: profile, error: profileError } = await admin.rpc("admin_get_profile", { target_user: stream.user_id });
  if (profileError || !profile) {
    log("profile lookup failed, skipping", stream.id, profileError?.message);
    return "found";
  }
  const p = profile as Profile;

  if (p.sparks < upfrontCost) {
    await notify(
      admin,
      stream.user_id,
      `New VOD from ${channelLabel} found — top up Sparks to auto-clip it (needs ${upfrontCost}⚡, you have ${p.sparks}⚡).`
    );
    log("skip+notify (low sparks)", stream.id, video.id, `need=${upfrontCost}`, `have=${p.sparks}`);
    return "found";
  }

  const workDir = await mkdtemp(path.join(tmpdir(), "klyp-autoclip-"));
  try {
    const result = await runAnalysisPipeline({
      uploadedPath: null,
      url: video.url,
      durationHint: durationSeconds,
      clipCount,
      workDir,
    });

    const sparksSpent = estimateSparks(result.durationSeconds) + clipCharge(clipCount, result.clips.length);
    await admin.rpc("admin_consume_sparks", { target_user: stream.user_id, amount: sparksSpent });

    if (result.clips.length > 0) {
      const rows = result.clips.map((clip) => ({
        user_id: stream.user_id,
        url: video.url,
        title: clip.title,
        clip_type: clip.type,
        viral_score: Math.round(clip.viral_score),
        caption: clip.caption,
        reason: clip.reason,
        start_seconds: clip.start_seconds,
        end_seconds: clip.end_seconds,
        hooks: clip.hooks,
        words: clip.words,
      }));
      const { error: saveError } = await admin.from("clips").insert(rows);
      if (saveError) {
        // hooks/words columns may not exist yet (pre-migration-003 schema) —
        // mirrors the same fallback AnalyzePanel's client-side save uses.
        await admin.from("clips").insert(rows.map(({ hooks, words, ...rest }) => rest));
      }
    }

    await notify(
      admin,
      stream.user_id,
      `${channelLabel}'s new VOD is clipped — ${result.clips.length} clip${result.clips.length === 1 ? "" : "s"} ready in your dashboard.`
    );
    log("auto-clipped", stream.id, video.id, `${result.clips.length} clips`, `${sparksSpent}⚡`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Auto-clipping failed.";
    log("auto-clip FAILED", stream.id, video.id, message);
    await notify(admin, stream.user_id, `Auto-clipping failed for ${channelLabel}'s new VOD — you can still paste the link manually.`);
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }

  return "found";
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
      .select("id, user_id, twitch_user_id, twitch_login, last_seen_video_id")
      .eq("id", check.stream_id)
      .maybeSingle();

    if (!stream || !stream.twitch_user_id) {
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
    .select("id, user_id, twitch_user_id, twitch_login, last_seen_video_id")
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

/** Starts both background loops. Idempotent — safe to call more than once. */
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

  processPendingChecks().catch((err) => log("processPendingChecks crashed", err));
}
