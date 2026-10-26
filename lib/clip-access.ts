import { createAdminClient } from "@/lib/supabase/admin";
import { vodSourceKey } from "@/lib/vod-source";
import { sameClipWindow, withinClipWindow } from "@/lib/clip-access-core";
export { acquireUserProcessingSlot } from "@/lib/clip-access-core";

const sourceKey = (url: string) => vodSourceKey(url, url.startsWith("upload:") ? url.slice(7) : undefined);

/** Require ownership of a saved clip, or a window returned by this user's analysis. */
export async function canProcessClip(
  userId: string, clipId: string, url: string, start: number, end: number
): Promise<boolean> {
  const admin = createAdminClient();
  const requested = { source_key: sourceKey(url), start_seconds: start, end_seconds: end };
  if (clipId) {
    const { data, error } = await admin.from("clips")
      .select("url,start_seconds,end_seconds")
      .eq("id", clipId).eq("user_id", userId).maybeSingle();
    if (error) throw error;
    if (data && withinClipWindow(requested, {
      source_key: sourceKey(data.url), start_seconds: data.start_seconds, end_seconds: data.end_seconds,
    })) return true;
  }
  if (!requested.source_key) return false;
  const { data, error } = await admin.from("analysis_clip_history")
    .select("start_seconds,end_seconds")
    .eq("user_id", userId).eq("source_key", requested.source_key)
    .lte("start_seconds", start + 0.001).gte("end_seconds", end - 0.001)
    .limit(1);
  if (error) throw error;
  return !!data?.length;
}

/** Only a window returned by this user's analysis may be downloaded raw before saving. */
export async function canDownloadRawMoment(userId: string, url: string, start: number, end: number): Promise<boolean> {
  const key = sourceKey(url);
  if (!key || !Number.isFinite(start) || !Number.isFinite(end)) return false;
  const { data, error } = await createAdminClient().from("analysis_clip_history")
    .select("start_seconds,end_seconds")
    .eq("user_id", userId).eq("source_key", key)
    .gte("start_seconds", start - 0.001).lte("start_seconds", start + 0.001)
    .gte("end_seconds", end - 0.001).lte("end_seconds", end + 0.001)
    .limit(1);
  if (error) throw error;
  return !!data?.some(row => sameClipWindow(
    { source_key: key, start_seconds: start, end_seconds: end },
    { source_key: key, start_seconds: row.start_seconds, end_seconds: row.end_seconds },
  ));
}
