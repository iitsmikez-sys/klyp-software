/** Save one analyzed upload moment under an existing test user's RLS policy. */
import { loginExistingTestAccount } from "./smoke-auth.mjs";

const [, , email, uploadId] = process.argv;
if (!/^[0-9a-f-]{36}$/.test(uploadId ?? "")) throw new Error("Pass email and upload UUID.");
const { admin, client, user } = await loginExistingTestAccount(email);
const source = `upload:${uploadId}`;
const { data: history, error: historyError } = await admin.from("analysis_clip_history")
  .select("start_seconds,end_seconds").eq("user_id", user.id)
  .eq("source_key", source).order("created_at", { ascending: false }).limit(1);
if (historyError) throw historyError;
if (!history?.length) throw new Error("No analyzed window found for this upload.");
const { data: clip, error: saveError } = await client.from("clips").insert({
  user_id: user.id,
  url: source,
  title: "Klyp private release test",
  clip_type: "FUNNY",
  viral_score: 50,
  caption: "Private release test",
  reason: "Verify saved upload archival and deleted-source playback.",
  start_seconds: history[0].start_seconds,
  end_seconds: history[0].end_seconds,
}).select("id,archive_status").single();
if (saveError) throw saveError;
console.log(JSON.stringify({ saved: true, clipId: clip.id, archiveStatus: clip.archive_status }));
