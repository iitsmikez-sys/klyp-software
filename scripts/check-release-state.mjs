/** Read-only production schema readiness check. Run with server credentials. */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Supabase server credentials are required.");
const admin = createClient(url, key, { auth: { persistSession: false } });
const checks = [
  ["auto VOD queue", "auto_vod_jobs", "id"],
  ["archive retry state", "clip_archive_jobs", "retry_at"],
  ["editor drafts", "clip_editor_drafts", "revision"],
  ["creator feedback", "clip_feedback", "verdict"],
];
let missing = false;
for (const [label, table, column] of checks) {
  const { error } = await admin.from(table).select(column).limit(0);
  const ready = !error;
  console.log(`${label}: ${ready ? "ready" : "missing or inaccessible"}`);
  if (!ready) missing = true;
}
if (missing) process.exitCode = 1;
