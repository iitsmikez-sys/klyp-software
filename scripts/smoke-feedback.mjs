/** Verify creator signals on an owned release-test clip. */
import { loginExistingTestAccount } from "./smoke-auth.mjs";
const [, , email, clipId] = process.argv;
if (!/^[0-9a-f-]{36}$/.test(clipId ?? "")) throw new Error("Pass email and clip UUID.");
const { client } = await loginExistingTestAccount(email);
const { error } = await client.rpc("record_clip_feedback", {
  p_clip_id: clipId, p_signal: "approved" });
if (error) throw error;
const { data, error: readError } = await client.from("clip_feedback")
  .select("verdict,edited_at").eq("clip_id", clipId).single();
if (readError) throw readError;
if (data.verdict !== "approved" || !data.edited_at) {
  throw new Error("Expected approval and editor-use signals.");
}
console.log(JSON.stringify({ feedbackRecorded: true, editedRecorded: true }));
