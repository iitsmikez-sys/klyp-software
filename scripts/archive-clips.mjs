/**
 * Archives saved clips into the private `clip-media` bucket so they survive
 * their source VOD being deleted.
 *
 * Per clip, three objects under <user_id>/<clip_id>/:
 *   master.mp4 — 1080p CRF23, the re-export source (9:16 / 1:1 / 16:9)
 *   proxy.mp4  — 540p, what the preview player streams (~9x smaller)
 *   poster.jpg — still frame
 *
 * Sized for Supabase Free, measured not guessed: masters run 0.571 MB/s, so
 * this library's longest clip (77s) is 44MB — inside Free's hard 50MB
 * per-object cap. A byte budget stops the run well short of the 1GB plan limit,
 * because Free has no paid overage: exceeding it disrupts the project rather
 * than billing you.
 *
 * Nothing is ever deleted. A clip whose source is gone is recorded as
 * `unavailable` — kept and labelled, never silently dropped and never counted
 * as recovered.
 *
 *   node scripts/archive-clips.mjs --probe        # one clip, end to end, no DB writes
 *   node scripts/archive-clips.mjs --plan         # what would run, and the byte cost
 *   node scripts/archive-clips.mjs --run          # archive, up to the budget
 *   node scripts/archive-clips.mjs --run --budget-mb 500
 */
import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const env = Object.fromEntries(
  fs.readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const BUCKET = "clip-media";
/** Free allows 1GB total; stop short so the project is never disrupted. */
const DEFAULT_BUDGET_MB = 800;
/** Free rejects any single object above this. */
const MAX_OBJECT_BYTES = 50 * 1024 * 1024;

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const budgetBytes = Number(arg("--budget-mb", DEFAULT_BUDGET_MB)) * 1024 * 1024;

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const run = (bin, args, opts = {}) =>
  new Promise((resolve, reject) => {
    const p = spawn(bin, args, { ...opts });
    let err = "";
    p.stderr.on("data", (d) => { err += d.toString(); });
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(bin)} exited ${code}: ${err.slice(-400)}`))));
    p.on("error", reject);
  });

const twitchId = (url) => (url.match(/twitch\.tv\/videos\/(\d+)/i) || [])[1];

/** Which sources Twitch still has. Anything absent is gone for good. */
async function liveTwitchIds(ids) {
  if (ids.length === 0) return new Set();
  const tok = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.TWITCH_CLIENT_ID,
      client_secret: env.TWITCH_CLIENT_SECRET,
      grant_type: "client_credentials",
    }),
  }).then((r) => r.json()).then((j) => j.access_token);
  const live = new Set();
  for (let i = 0; i < ids.length; i += 100) {
    const q = ids.slice(i, i + 100).map((id) => `id=${id}`).join("&");
    const res = await fetch(`https://api.twitch.tv/helix/videos?${q}`, {
      headers: { "Client-Id": env.TWITCH_CLIENT_ID, Authorization: `Bearer ${tok}` },
    });
    const j = await res.json();
    for (const v of j.data ?? []) live.add(v.id);
  }
  return live;
}

/** Cut the clip's own range from the source and produce the three assets. */
async function buildAssets(clip, dir) {
  const src = path.join(dir, "src.mp4");
  const start = Math.max(0, Math.floor(clip.start_seconds));
  const end = Math.ceil(clip.end_seconds);

  await run(env.YTDLP_PATH, [
    "--quiet", "--no-warnings", "--ffmpeg-location", env.FFMPEG_PATH,
    "-f", "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*[height<=1080]+ba/b",
    "--download-sections", `*${start}-${end}`,
    "-o", src.replace(/\.mp4$/, ".%(ext)s"),
    clip.url,
  ]);

  const master = path.join(dir, "master.mp4");
  const proxy = path.join(dir, "proxy.mp4");
  const poster = path.join(dir, "poster.jpg");

  // CRF23 keeps full 1080p for 16:9 re-export while staying inside the 50MB cap.
  await run(env.FFMPEG_PATH, ["-hide_banner", "-loglevel", "error", "-i", src,
    "-c:v", "libx264", "-crf", "23", "-preset", "medium", "-vf", "scale=-2:1080",
    "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "-y", master]);
  await run(env.FFMPEG_PATH, ["-hide_banner", "-loglevel", "error", "-i", src,
    "-c:v", "libx264", "-crf", "26", "-preset", "veryfast", "-vf", "scale=-2:540",
    "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", "-y", proxy]);
  await run(env.FFMPEG_PATH, ["-hide_banner", "-loglevel", "error",
    "-ss", String((end - start) / 2), "-i", src, "-frames:v", "1", "-q:v", "4", "-y", poster]);

  return { master, proxy, poster };
}

async function upload(localPath, objectPath, contentType) {
  const body = fs.readFileSync(localPath);
  if (body.byteLength > MAX_OBJECT_BYTES) {
    throw new Error(`${path.basename(localPath)} is ${(body.byteLength / 1048576).toFixed(1)}MB, over the 50MB Free-plan cap`);
  }
  // upsert so a retry overwrites a partial object instead of erroring.
  const { error } = await admin.storage.from(BUCKET).upload(objectPath, body, { contentType, upsert: true });
  if (error) throw new Error(`upload ${objectPath}: ${error.message}`);
  return body.byteLength;
}

/* ── Load clips and work out what is recoverable ── */
const { data: clips, error } = await admin
  .from("clips")
  .select("id,user_id,url,title,start_seconds,end_seconds,created_at,archive_status")
  .order("created_at", { ascending: false });
if (error) { console.error("Could not load clips:", error.message); process.exit(1); }

const ids = [...new Set(clips.map((c) => twitchId(c.url)).filter(Boolean))];
const live = await liveTwitchIds(ids);

const classify = (c) => {
  if (c.url.startsWith("upload:")) return "unavailable"; // source file long gone from the ephemeral cache
  const tid = twitchId(c.url);
  if (tid) return live.has(tid) ? "recoverable" : "unavailable";
  if (/youtu/.test(c.url)) return "recoverable"; // YouTube keeps its videos
  return "unavailable";
};

const recoverable = clips.filter((c) => classify(c) === "recoverable");
const unavailable = clips.filter((c) => classify(c) !== "recoverable");
const estBytes = (c) => (c.end_seconds - c.start_seconds) * (0.571 + 0.066) * 1048576 + 72000;
const estTotal = recoverable.reduce((s, c) => s + estBytes(c), 0);

console.log(`clips: ${clips.length} | recoverable: ${recoverable.length} | unavailable: ${unavailable.length}`);
console.log(`estimated to archive all recoverable: ${(estTotal / 1048576).toFixed(0)} MB (budget ${(budgetBytes / 1048576).toFixed(0)} MB)`);

if (has("--plan")) {
  let acc = 0, fits = 0;
  for (const c of recoverable) { if (acc + estBytes(c) > budgetBytes) break; acc += estBytes(c); fits++; }
  console.log(`within budget: ${fits} of ${recoverable.length} clips (${(acc / 1048576).toFixed(0)} MB)`);
  process.exit(0);
}

/* ── Probe: one clip end to end, no database writes ── */
if (has("--probe")) {
  const c = recoverable[0];
  if (!c) { console.log("nothing recoverable to probe"); process.exit(0); }
  console.log(`probing: "${c.title}" (${Math.round(c.end_seconds - c.start_seconds)}s)`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "klyp-archive-"));
  try {
    const a = await buildAssets(c, dir);
    const base = `${c.user_id}/${c.id}`;
    const bytes =
      (await upload(a.master, `${base}/master.mp4`, "video/mp4")) +
      (await upload(a.proxy, `${base}/proxy.mp4`, "video/mp4")) +
      (await upload(a.poster, `${base}/poster.jpg`, "image/jpeg"));
    console.log(`uploaded ${(bytes / 1048576).toFixed(1)} MB to ${base}/`);
    const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(`${base}/proxy.mp4`, 60);
    const head = await fetch(signed.signedUrl, { method: "GET", headers: { Range: "bytes=0-1023" } });
    console.log(`signed proxy URL: HTTP ${head.status}, ${head.headers.get("content-type")}`);
    console.log("probe complete — assets are in durable storage and readable via a signed URL");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  process.exit(0);
}

/* ── Mark everything with no retrievable source, honestly ── */
if (has("--run")) {
  const lost = unavailable.filter((c) => c.archive_status !== "unavailable");
  if (lost.length > 0) {
    // Recorded, never deleted: the row and its metadata stay, the footage is
    // simply gone and the UI can say so instead of offering a broken export.
    const { error: e } = await admin
      .from("clips")
      .update({ archive_status: "unavailable", archive_error: "Source video no longer available" })
      .in("id", lost.map((c) => c.id));
    if (e) { console.error("could not mark unavailable:", e.message); process.exit(1); }
  }
  console.log(`marked unavailable: ${lost.length}`);

  let used = 0, stored = 0, skipped = 0, failed = 0, reused = 0;

  for (const c of recoverable) {
    if (c.archive_status === "stored") { skipped++; continue; }

    if (used + estBytes(c) > budgetBytes) {
      console.log(`budget reached (${(used / 1048576).toFixed(0)} MB) — stopping, remaining clips stay at status 'none' and can be archived later`);
      break;
    }

    // Claim the clip. A retry bumps the row rather than starting a parallel
    // upload; storage paths are deterministic and uploaded with upsert, so a
    // repeated job can never produce duplicate objects.
    await admin.from("clip_archive_jobs")
      .upsert({ clip_id: c.id, status: "processing", updated_at: new Date().toISOString() }, { onConflict: "clip_id" });

    const base = `${c.user_id}/${c.id}`;
    const label = c.title.slice(0, 44);

    try {
      // Already in the bucket (e.g. from --probe)? Record it, don't re-upload.
      const { data: present } = await admin.storage.from(BUCKET).list(base);
      const names = new Set((present ?? []).map((o) => o.name));
      let bytes = (present ?? []).reduce((sum, o) => sum + (o.metadata?.size ?? 0), 0);
      let wasPresent = names.has("master.mp4") && names.has("proxy.mp4") && names.has("poster.jpg");

      if (!wasPresent) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "klyp-archive-"));
        try {
          const a = await buildAssets(c, dir);
          bytes =
            (await upload(a.master, `${base}/master.mp4`, "video/mp4")) +
            (await upload(a.proxy, `${base}/proxy.mp4`, "video/mp4")) +
            (await upload(a.poster, `${base}/poster.jpg`, "image/jpeg"));
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
        stored++;
        console.log(`stored  ${(bytes / 1048576).toFixed(1).padStart(5)} MB  ${label}`);
      } else {
        reused++;
        console.log(`present ${(bytes / 1048576).toFixed(1).padStart(5)} MB  ${label} (already in bucket)`);
      }

      const { error: ue } = await admin.from("clips").update({
        master_path: `${base}/master.mp4`,
        proxy_path: `${base}/proxy.mp4`,
        poster_path: `${base}/poster.jpg`,
        archive_status: "stored",
        archive_error: null,
        archived_at: new Date().toISOString(),
        archive_bytes: bytes,
      }).eq("id", c.id);
      if (ue) throw new Error(`db update: ${ue.message}`);

      await admin.from("clip_archive_jobs")
        .update({ status: "done", last_error: null, updated_at: new Date().toISOString() })
        .eq("clip_id", c.id);
      used += bytes;
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`FAILED        ${label}: ${msg.slice(0, 80)}`);
      // Left retryable on purpose — a failed archive is not an absent source.
      await admin.from("clips")
        .update({ archive_status: "failed", archive_error: msg.slice(0, 300) })
        .eq("id", c.id);
      await admin.from("clip_archive_jobs")
        .update({ status: "failed", last_error: msg.slice(0, 300), updated_at: new Date().toISOString() })
        .eq("clip_id", c.id);
    }
  }

  console.log(`\nstored ${stored} | already present ${reused} | skipped ${skipped} | failed ${failed}`);
  console.log(`storage written this run: ${(used / 1048576).toFixed(0)} MB (budget ${(budgetBytes / 1048576).toFixed(0)} MB)`);
  process.exit(0);
}


console.log("\nno action taken. --plan to see what fits, --probe to test one clip, --run to archive.");
