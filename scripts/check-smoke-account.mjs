/** Read-only validation of an existing Klyp release-test account. */
import { createClient } from "@supabase/supabase-js";
const email = process.argv[2];
if (!email || !email.endsWith("@example.com")) {
  throw new Error("KLYP_TEST_EMAIL must identify an existing example.com test account.");
}
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
let user;
for (let page = 1; page <= 20 && !user; page++) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) throw error;
  user = data.users.find((item) => item.email === email);
  if (data.users.length < 1000) break;
}
if (!user) throw new Error("Existing test account not found.");
const { data: profile, error } = await admin.from("profiles")
  .select("id,sparks,tier").eq("id", user.id).single();
if (error) throw error;
const { count: clips, error: clipsError } = await admin.from("clips")
  .select("id", { count: "exact", head: true }).eq("user_id", user.id);
if (clipsError) throw clipsError;
const { count: transcripts, error: transcriptsError } = await admin.from("transcripts")
  .select("id", { count: "exact", head: true }).eq("user_id", user.id);
if (transcriptsError) throw transcriptsError;
console.log(JSON.stringify({ accountFound: true, sparks: profile.sparks,
  tier: profile.tier, clips, transcripts }));
if (process.argv.includes("--clips")) {
  const { data, error: listError } = await admin.from("clips")
    .select("id,url,title,start_seconds,end_seconds,archive_status,master_path,archive_error,created_at")
    .eq("user_id", user.id).order("created_at", { ascending: false }).limit(10);
  if (listError) throw listError;
  console.log(JSON.stringify(data));
}
