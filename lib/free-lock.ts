/**
 * Server side of the Free "taste" (see lib/free-taste.ts): on an analysis that a Free account ran, only the best few clips may be
 * previewed, exported or downloaded. Only analyses started under this rule are affected (the job records `freeTaste`), so every
 * clip a person already has stays open. A Pro account is never locked, including one that upgraded after the analysis.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { vodSourceKey } from "@/lib/vod-source";
import { withinClipWindow } from "@/lib/clip-access-core";
import { planOf } from "@/lib/plan-limits";
import { unlockedIndexes } from "@/lib/free-taste";

type Row = { viral_score?: number; start_seconds: number; end_seconds: number };

/** True when the asked-for moment belongs to a Free analysis and is not one of its unlocked clips. */
export async function isClipLockedForFree(userId: string, url: string, start: number, end: number): Promise<boolean> {
  const key = vodSourceKey(url, url.startsWith("upload:") ? url.slice(7) : undefined);
  if (!key || !Number.isFinite(start) || !Number.isFinite(end)) return false;
  const admin = createAdminClient();
  const { data: profile, error: profileError } = await admin.from("profiles")
    .select("tier,stripe_subscription_id").eq("id", userId).maybeSingle();
  if (profileError) throw profileError;
  if (!profile) return false;
  // Complimentary Pro is an account flag (Auth app_metadata), not a profiles column; it only matters for a "pro" profile with no subscription.
  let complimentary = false;
  if (profile.tier === "pro" && !profile.stripe_subscription_id) {
    const { data: account, error: accountError } = await admin.auth.admin.getUserById(userId);
    if (accountError) throw accountError;
    complimentary = account?.user?.app_metadata?.klyp_complimentary_pro === true;
  }
  if (planOf({ tier: profile.tier, stripe_subscription_id: profile.stripe_subscription_id ?? null, complimentary_pro: complimentary }) === "pro") return false;
  const { data, error } = await admin.from("analysis_jobs")
    .select("analysis_clips,request_payload")
    .eq("user_id", userId).eq("source_key", key).eq("status", "completed")
    .order("created_at", { ascending: false }).limit(1);
  if (error) throw error;
  const job = data?.[0] as { analysis_clips: Row[] | null; request_payload: { freeTaste?: boolean } | null } | undefined;
  if (!job || job.request_payload?.freeTaste !== true || !Array.isArray(job.analysis_clips)) return false;
  const clips = job.analysis_clips;
  const open = unlockedIndexes(clips.map((c) => ({ viral_score: c.viral_score ?? 0 })), false);
  const requested = { source_key: key, start_seconds: start, end_seconds: end };
  const at = (c: Row) => ({ source_key: key, start_seconds: c.start_seconds, end_seconds: c.end_seconds });
  const matches = clips.map((c, i) => ({ i, hit: withinClipWindow(requested, at(c)) })).filter((m) => m.hit);
  if (matches.length === 0) return false; // not a moment of this analysis: the usual ownership checks decide
  return !matches.some((m) => open.has(m.i));
}
