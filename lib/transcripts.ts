/**
 * Persists the raw per-VOD transcript so it survives past the single
 * /api/analyze request that produced it — see migration 006_transcripts.sql.
 * Bearer-token variant matching lib/profile-token.ts, since this runs on the
 * processing service under the requesting user's auth, not a service role.
 */
import { tokenClient } from "@/lib/profile-token";
import type { TimedWord } from "@/lib/clips";

export async function saveTranscript(
  token: string,
  params: { url: string; durationSeconds: number; words: TimedWord[]; userId: string; jobId?: string; sourceKey?: string; coverageMode?: "full" | "chat-sampled" }
): Promise<void> {
  const supabase = tokenClient(token);
  const transcriptText = params.words.map((w) => w.text).join(" ");
  const row = {
    user_id: params.userId,
    url: params.url,
    duration_seconds: params.durationSeconds,
    words: params.words,
    transcript_text: transcriptText,
    ...(params.jobId ? { analysis_job_id: params.jobId, source_key: params.sourceKey, coverage_mode: params.coverageMode } : {}),
  };
  const { error } = await supabase.from("transcripts").insert(row);
  if (error) throw new Error(`Failed to save transcript: ${error.message}`);
}

export async function loadJobTranscript(token: string, jobId: string) {
  const { data, error } = await tokenClient(token).from("transcripts")
    .select("words,duration_seconds,coverage_mode").eq("analysis_job_id", jobId).maybeSingle();
  if (error) throw new Error(`Could not load transcript checkpoint: ${error.message}`);
  return data ? { words: data.words as TimedWord[], durationSeconds: Number(data.duration_seconds), coverageMode: data.coverage_mode as "full" | "chat-sampled" } : null;
}

/** Cross-job reuse is limited to confirmed full coverage from the same user/source. */
export async function findReusableFullTranscript(token: string, sourceKey: string) {
  const { data, error } = await tokenClient(token).from("transcripts")
    .select("words,duration_seconds,coverage_mode")
    .eq("source_key", sourceKey).eq("coverage_mode", "full")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`Could not load reusable transcript: ${error.message}`);
  return data ? { words: data.words as TimedWord[], durationSeconds: Number(data.duration_seconds), coverageMode: "full" as const } : null;
}
