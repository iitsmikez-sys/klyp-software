/** Read-only production archive backlog and estimated storage footprint. */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Supabase server credentials are required.");
const admin = createClient(url, key, { auth: { persistSession: false } });
let offset = 0;
const rows = [];
while (true) {
  const { data, error } = await admin.from("clips")
    .select("archive_status,archive_bytes,start_seconds,end_seconds")
    .range(offset, offset + 999);
  if (error) throw error;
  rows.push(...data);
  if (data.length < 1000) break;
  offset += 1000;
}
const counts = Object.groupBy(rows, (row) => row.archive_status ?? "null");
const storedBytes = rows.reduce((sum, row) => sum + Number(row.archive_bytes ?? 0), 0);
const pendingSeconds = rows.filter((row) => ["pending", "failed", "processing"].includes(row.archive_status))
  .reduce((sum, row) => sum + Math.max(0, Number(row.end_seconds) - Number(row.start_seconds)), 0);
const { data: vodJobs, error: vodError } = await admin.from("auto_vod_jobs").select("status");
if (vodError) throw vodError;
const vodCounts = Object.groupBy(vodJobs, (job) => job.status);
console.log(JSON.stringify({ totalClips: rows.length,
  archiveStatuses: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v.length])),
  storedMB: Math.round(storedBytes / 1048576),
  pendingSeconds: Math.round(pendingSeconds),
  estimatedPendingMB: Math.round(pendingSeconds * 0.637),
  autoVodJobs: Object.fromEntries(Object.entries(vodCounts).map(([k, v]) => [k, v.length])),
}, null, 2));
if (process.argv.includes("--pending")) {
  const { data, error } = await admin.from("clips")
    .select("id,url,title,created_at")
    .eq("archive_status", "pending").order("created_at", { ascending: false }).limit(10);
  if (error) throw error;
  console.log(JSON.stringify({ pending: data }, null, 2));
}
