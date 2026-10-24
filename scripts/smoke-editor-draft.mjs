/** Two independent sessions must preserve the newer editor revision. */
import { createClient } from "@supabase/supabase-js";
import { loginExistingTestAccount } from "./smoke-auth.mjs";

const [, , email, clipId] = process.argv;
if (!/^[0-9a-f-]{36}$/.test(clipId ?? "")) throw new Error("Pass email and owned clip UUID.");
const { client: first, token } = await loginExistingTestAccount(email);
const second = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false } });
const { data: previous, error: previousError } = await first.from("clip_editor_drafts")
  .select("revision").eq("clip_id", clipId).maybeSingle();
if (previousError) throw previousError;
if (previous) throw new Error("Choose a test clip without a prior draft.");
const draft = { version: 1, hook: null, hookStyle: "IMPACT", captionStyle: "PULSE",
  captionColor: "DEFAULT", captionPosition: "BOTTOM", format: "9:16",
  layout: { mode: "FILL", x: 0.5, y: 0.5 }, segments: [{ start: 0, end: 48 }], media: [] };
const { data: firstRevision, error: firstError } = await first.rpc("save_clip_editor_draft", {
  p_clip_id: clipId, p_base_revision: 0, p_draft: draft });
if (firstError) throw firstError;
const { data: loaded, error: loadError } = await second.from("clip_editor_drafts")
  .select("revision,draft").eq("clip_id", clipId).single();
if (loadError) throw loadError;
if (loaded.revision !== firstRevision || loaded.draft.captionStyle !== "PULSE") {
  throw new Error("Second session did not load the first draft.");
}
const { data: secondRevision, error: secondError } = await second.rpc("save_clip_editor_draft", {
  p_clip_id: clipId, p_base_revision: loaded.revision,
  p_draft: { ...loaded.draft, format: "Original" } });
if (secondError) throw secondError;
const { error: staleError } = await first.rpc("save_clip_editor_draft", {
  p_clip_id: clipId, p_base_revision: firstRevision, p_draft: { ...draft, format: "1:1" } });
if (!staleError?.message?.includes("draft conflict")) throw new Error("Stale save was not rejected.");
const { data: final, error: finalError } = await first.from("clip_editor_drafts")
  .select("revision,draft").eq("clip_id", clipId).single();
if (finalError) throw finalError;
if (final.revision !== secondRevision || final.draft.format !== "Original") {
  throw new Error("Newer revision was overwritten.");
}
const { error: feedbackError } = await first.rpc("record_clip_feedback", {
  p_clip_id: clipId, p_signal: "approved" });
if (feedbackError) throw feedbackError;
const { data: feedback, error: readFeedbackError } = await second.from("clip_feedback")
  .select("verdict,edited_at").eq("clip_id", clipId).single();
if (readFeedbackError) throw readFeedbackError;
if (feedback.verdict !== "approved" || !feedback.edited_at) {
  throw new Error("Creator feedback did not record approval and editor usage.");
}
console.log(JSON.stringify({ crossSessionLoad: true, staleSaveRejected: true,
  revision: final.revision, format: final.draft.format,
  feedbackRecorded: true }));
