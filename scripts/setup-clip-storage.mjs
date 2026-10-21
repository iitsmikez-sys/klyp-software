/**
 * Creates the private `clip-media` bucket that holds archived clip footage.
 *
 * Private on purpose: objects are reachable only through short-lived signed
 * URLs minted server-side for the owning user, so one customer can never read
 * another's footage by guessing a path. Paths are <user_id>/<clip_id>/<asset>,
 * which also makes per-user cleanup trivial if retention is added later.
 *
 * Safe to re-run — it reports an existing bucket instead of recreating it, and
 * never deletes anything.
 *
 *   node scripts/setup-clip-storage.mjs          # report only
 *   node scripts/setup-clip-storage.mjs --create # actually create the bucket
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const env = Object.fromEntries(
  fs.readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const BUCKET = "clip-media";
/** A 1080p master of a long clip; well clear of the measured ~39MB for 58s. */
const FILE_SIZE_LIMIT = 200 * 1024 * 1024;

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const { data: buckets, error: listErr } = await admin.storage.listBuckets();
if (listErr) {
  console.error("Could not list buckets:", listErr.message);
  process.exit(1);
}

const existing = buckets.find((b) => b.name === BUCKET);
if (existing) {
  console.log(`bucket "${BUCKET}" already exists (public=${existing.public}) — nothing to do`);
  if (existing.public) {
    console.warn("WARNING: this bucket is public. Archived footage should be private.");
  }
  process.exit(0);
}

if (!process.argv.includes("--create")) {
  console.log(`bucket "${BUCKET}" does not exist.`);
  console.log("Re-run with --create to create it (private, 200MB object limit, video/* + image/jpeg).");
  process.exit(0);
}

const { error } = await admin.storage.createBucket(BUCKET, {
  public: false,
  fileSizeLimit: FILE_SIZE_LIMIT,
  allowedMimeTypes: ["video/mp4", "image/jpeg"],
});
if (error) {
  console.error("Could not create bucket:", error.message);
  process.exit(1);
}
console.log(`created private bucket "${BUCKET}" (limit ${FILE_SIZE_LIMIT / 1024 / 1024}MB)`);
