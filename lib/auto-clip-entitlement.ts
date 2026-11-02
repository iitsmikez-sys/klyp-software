/**
 * Automatic clipping is a Pro feature. This is the one place that decides it for the
 * background worker, the Twitch event route and the on/off toggle, and that cleans up
 * after a channel whose owner is not (or is no longer) entitled.
 *
 * No migration and no manual SQL: a channel that has auto_clip_enabled on but whose owner
 * has no Pro access is switched off the first time any of those code paths meets it, its
 * queued work is cancelled, and the owner gets ONE notification. After upgrading they turn
 * it back on themselves — never silently, so no surprise Spark spend.
 */
import { planOf, autoClipAllowed } from "./plan-limits.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

export const AUTO_CLIP_ACTIVE_JOB_STATUSES = ["pending", "retry", "processing"];

/**
 * Whether this user may use automatic clipping: a real Stripe subscription or complimentary
 * Pro (a server-managed Auth flag). The bare tier flag alone is never trusted. Throws if the
 * answer cannot be determined — callers must then leave everything as it is.
 */
export async function hasAutoClipAccess(admin: Admin, userId: string): Promise<boolean> {
  const { data: profile, error } = await admin
    .from("profiles").select("tier, stripe_subscription_id").eq("id", userId).maybeSingle();
  if (error) throw new Error(`Could not load the plan: ${error.message ?? error}`);
  if (!profile) return false;

  let complimentary = false;
  // Complimentary access only matters for a "pro" profile that has no subscription behind it.
  if (profile.tier === "pro" && !profile.stripe_subscription_id) {
    const { data, error: userError } = await admin.auth.admin.getUserById(userId);
    if (userError) throw new Error(`Could not load the account: ${userError.message ?? userError}`);
    complimentary = data?.user?.app_metadata?.klyp_complimentary_pro === true;
  }
  return autoClipAllowed(planOf({
    tier: profile.tier,
    stripe_subscription_id: profile.stripe_subscription_id ?? null,
    complimentary_pro: complimentary,
  }));
}

export type StreamRef = { id: string; user_id: string; twitch_login?: string | null };

/**
 * Turn auto-clipping off for a channel and clear its queued work. Returns true only if this
 * call is the one that switched it off, so the owner is told exactly once even if the worker,
 * the sweep and the event route all meet the same channel.
 */
export async function revokeAutoClip(
  admin: Admin,
  stream: StreamRef,
  notify: (userId: string, message: string) => Promise<void>
): Promise<boolean> {
  const { data: changed, error } = await admin
    .from("streams").update({ auto_clip_enabled: false })
    .eq("id", stream.id).eq("auto_clip_enabled", true).select("id");
  if (error) throw new Error(`Could not turn off auto-clipping: ${error.message ?? error}`);
  if (!changed || changed.length === 0) return false; // already off

  // The finish step also checks this flag under a row lock, so a job already running cannot commit a charge.
  const { error: jobsError } = await admin.from("auto_vod_jobs")
    .update({ status: "canceled", lease_until: null })
    .eq("stream_id", stream.id).in("status", AUTO_CLIP_ACTIVE_JOB_STATUSES);
  if (jobsError) throw new Error(`Could not clear queued auto-clip work: ${jobsError.message ?? jobsError}`);
  const { error: checksError } = await admin.from("pending_vod_checks").delete().eq("stream_id", stream.id);
  if (checksError) throw new Error(`Could not clear pending VOD checks: ${checksError.message ?? checksError}`);

  const channel = stream.twitch_login ? ` for ${stream.twitch_login}` : "";
  await notify(stream.user_id, `Automatic clipping is a Pro feature, so it was turned off${channel}. Upgrade to Pro to turn it back on.`);
  return true;
}

/** True if the channel may keep auto-clipping; otherwise it has been switched off (once, with a notice). */
export async function ensureAutoClipEntitled(
  admin: Admin,
  stream: StreamRef,
  notify: (userId: string, message: string) => Promise<void>
): Promise<boolean> {
  if (await hasAutoClipAccess(admin, stream.user_id)) return true;
  await revokeAutoClip(admin, stream, notify);
  return false;
}
