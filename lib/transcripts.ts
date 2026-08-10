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
  params: { url: string; durationSeconds: number; words: TimedWord[] }
): Promise<void> {
  const supabase = tokenClient(token);
  const transcriptText = params.words.map((w) => w.text).join(" ");
  const { error } = await supabase.from("transcripts").insert({
    url: params.url,
    duration_seconds: params.durationSeconds,
    words: params.words,
    transcript_text: transcriptText,
  });
  if (error) throw new Error(`Failed to save transcript: ${error.message}`);
}
