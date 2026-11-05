import { createAdminClient } from "@/lib/supabase/admin";
import { vodSourceKey } from "@/lib/vod-source";
import { sameClipWindow, withinClipWindow } from "@/lib/clip-access-core";
import { isMediaExpired } from "@/lib/clip-expiry";
import { resultsCutoffIso } from "@/lib/results-retention";
export { acquireUserProcessingSlot } from "@/lib/clip-access-core";

const sourceKey = (url: string) => vodSourceKey(url, url.startsWith("upload:") ? url.slice(7) : undefined);

/** Require ownership of a saved clip, or a window returned by this user's analysis. */
export async function canProcessClip(
  userId: string, clipId: string, url: string, start: number, end: number
): Promise<boolean> {
  const admin = createAdminClient();
  const requested = { source_key: sourceKey(url), start_seconds: start, end_seconds: end };
  // The expiry date column exists once the R2 retention migration is applied (same switch as the archive code).
  const withExpiry = process.env.R2_ENABLED === '1';
  const columns: string = withExpiry ? "url,start_seconds,end_seconds,archive_status,media_expires_at" : "url,start_seconds,end_seconds,archive_status";
  if (clipId) {
    const { data: row, error } = await admin.from("clips")
      .select(columns)
      .eq("id", clipId).eq("user_id", userId).maybeSingle();
    if (error) throw error;
    const data = row as unknown as { url: string; start_seconds: number; end_seconds: number; archive_status?: string | null; media_expires_at?: string | null } | null;
    // Expired footage: no preview, no export, no download, even by date before the cleanup job has marked it.
    if (isMediaExpired(data)) return false;
    if (data && withinClipWindow(requested, {
      source_key: sourceKey(data.url), start_seconds: data.start_seconds, end_seconds: data.end_seconds,
    })) return true;
  }
  if (!requested.source_key) return false;
  // A moment whose saved copy has expired cannot be re-made from the source by leaving out the clip id.
  if (await hasExpiredSavedWindow(userId, requested, withExpiry)) return false;
  // An analysis result that was never saved can only be used for 5 days on Free (30 on Pro).
  const cutoff = await resultsCutoff(userId);
  const { data, error } = await admin.from("analysis_clip_history")
    .select("start_seconds,end_seconds")
    .eq("user_id", userId).eq("source_key", requested.source_key)
    .gte("created_at", cutoff)
    .lte("start_seconds", start + 0.001).gte("end_seconds", end - 0.001)
    .limit(1);
  if (error) throw error;
  return !!data?.length;
}

/** Results older than this are too old for the user's plan (Pro matches the database rule: tier = 'pro'). */
async function resultsCutoff(userId: string): Promise<string> {
  const { data, error } = await createAdminClient().from("profiles").select("tier").eq("id", userId).maybeSingle();
  if (error) throw error;
  return resultsCutoffIso((data as { tier?: string | null } | null)?.tier === "pro");
}

/** Did this user save this moment, and has its saved footage expired? */
async function hasExpiredSavedWindow(
  userId: string, requested: { source_key: string | null; start_seconds: number; end_seconds: number }, withExpiry: boolean,
): Promise<boolean> {
  if (!requested.source_key) return false;
  const admin = createAdminClient();
  const columns: string = withExpiry ? "url,start_seconds,end_seconds,archive_status,media_expires_at" : "url,start_seconds,end_seconds,archive_status";
  const base = admin.from("clips").select(columns).eq("user_id", userId);
  const { data, error } = await (withExpiry
    ? base.or(`archive_status.eq.expired,media_expires_at.lte.${new Date().toISOString()}`)
    : base.eq("archive_status", "expired")).limit(1000);
  if (error) throw error;
  return ((data ?? []) as unknown as { url: string; start_seconds: number; end_seconds: number }[]).some((row) => {
    const saved = { source_key: sourceKey(row.url), start_seconds: row.start_seconds, end_seconds: row.end_seconds };
    return withinClipWindow(requested, saved) || sameClipWindow(requested, saved);
  });
}

/** Only a window returned by this user's analysis may be downloaded raw before saving. */
export async function canDownloadRawMoment(userId: string, url: string, start: number, end: number): Promise<boolean> {
  const key = sourceKey(url);
  if (!key || !Number.isFinite(start) || !Number.isFinite(end)) return false;
  const cutoff = await resultsCutoff(userId);
  const { data, error } = await createAdminClient().from("analysis_clip_history")
    .select("start_seconds,end_seconds")
    .eq("user_id", userId).eq("source_key", key)
    .gte("created_at", cutoff)
    .gte("start_seconds", start - 0.001).lte("start_seconds", start + 0.001)
    .gte("end_seconds", end - 0.001).lte("end_seconds", end + 0.001)
    .limit(1);
  if (error) throw error;
  return !!data?.some(row => sameClipWindow(
    { source_key: key, start_seconds: start, end_seconds: end },
    { source_key: key, start_seconds: row.start_seconds, end_seconds: row.end_seconds },
  ));
}
