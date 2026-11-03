/**
 * Persists the raw per-VOD transcript so it survives past the single
 * /api/analyze request that produced it — see migration 006_transcripts.sql.
 * Bearer-token variant matching lib/profile-token.ts, since this runs on the
 * processing service under the requesting user's auth, not a service role.
 */
import { tokenClient } from "@/lib/profile-token";
import { createAdminClient } from "@/lib/supabase/admin";
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

/** A saved transcript is only reused when it covers the video as it is now (a stream that was still live
 *  when first analyzed has a shorter transcript than the finished VOD). */
const SAME_LENGTH_SLACK_SECONDS = 60;
const lengthMatches = (saved: number, expected: number | undefined) =>
  expected === undefined || Math.abs(saved - expected) <= SAME_LENGTH_SLACK_SECONDS;

/** Public sources only: a YouTube or Twitch video id is the same for everyone, an upload is private. */
export const isSharedSource = (sourceKey: string) => /^(youtube:[A-Za-z0-9_-]{11}|twitch:[0-9]+)$/.test(sourceKey);

type Row = { words: unknown; duration_seconds: unknown };
const asTranscript = (row: Row) => ({ words: row.words as TimedWord[], durationSeconds: Number(row.duration_seconds), coverageMode: "full" as const });

/**
 * Reuse of a confirmed full-coverage transcript, so the paid transcription is skipped:
 *  1. this user's own earlier transcript of the same source, then
 *  2. for public YouTube and Twitch videos only, ANOTHER user's transcript of the same video.
 * Both must match the video's current length (`expectedSeconds`).
 */
export async function findReusableFullTranscript(token: string, sourceKey: string, expectedSeconds?: number) {
  const { data, error } = await tokenClient(token).from("transcripts")
    .select("words,duration_seconds,coverage_mode")
    .eq("source_key", sourceKey).eq("coverage_mode", "full")
    .order("created_at", { ascending: false }).limit(5);
  if (error) throw new Error(`Could not load reusable transcript: ${error.message}`);
  const own = ((data ?? []) as Row[]).find((row) => lengthMatches(Number(row.duration_seconds), expectedSeconds));
  if (own) return asTranscript(own);

  if (!isSharedSource(sourceKey)) return null;
  try {
    const { data: shared, error: sharedError } = await createAdminClient().from("transcripts")
      .select("words,duration_seconds,coverage_mode")
      .eq("source_key", sourceKey).eq("coverage_mode", "full")
      .order("created_at", { ascending: false }).limit(5);
    if (sharedError) return null; // never fail an analysis because the shared lookup did
    const hit = ((shared ?? []) as Row[]).find((row) => lengthMatches(Number(row.duration_seconds), expectedSeconds));
    return hit ? asTranscript(hit) : null;
  } catch {
    return null;
  }
}
