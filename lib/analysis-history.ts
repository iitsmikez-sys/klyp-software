import { tokenClient } from "@/lib/profile-token";
import type { ClipWithWords } from "@/lib/clips";
import type { ClipCount } from "@/lib/sparks";

export type ClipWindow = { start_seconds: number; end_seconds: number };

export async function priorClipWindows(token: string, sourceKey: string): Promise<ClipWindow[]> {
  const { data, error } = await tokenClient(token)
    .from("analysis_clip_history")
    .select("start_seconds,end_seconds")
    .eq("source_key", sourceKey)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw new Error(`Cannot check earlier clips: ${error.message}`);
  return (data ?? []) as ClipWindow[];
}

/** One database transaction filters repeats, saves new windows, and charges Sparks. */
export async function recordAndChargeClips(
  token: string, sourceKey: string, clips: ClipWithWords[], durationSeconds: number, clipCount: ClipCount
): Promise<{ clips: ClipWithWords[]; sparksSpent: number; sparksBalance: number }> {
  const { data, error } = await tokenClient(token).rpc("record_analysis_clips", {
    p_source_key: sourceKey,
    p_clips: clips.map((clip) => ({ start_seconds: clip.start_seconds, end_seconds: clip.end_seconds })),
    p_duration_seconds: durationSeconds,
    p_requested_clips: clipCount,
  });
  if (error) throw new Error(`Could not save or charge clips: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || !Array.isArray(row.accepted_indices)) throw new Error("Clip accounting returned an invalid response.");
  return {
    clips: row.accepted_indices.map((index: number) => clips[index]),
    sparksSpent: row.sparks_spent,
    sparksBalance: row.sparks_balance,
  };
}
