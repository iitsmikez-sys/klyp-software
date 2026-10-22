/** Archives newly saved clips on the processing service, outside browser requests. */
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveSourceSegment } from "@/lib/video-cache";
import { runQueued } from "@/lib/job-queue";
import { CLIP_BUCKET } from "@/lib/clip-archive";
import { buildClipArchiveAssets } from "@/lib/clip-archive-assets";
import { isArchivableSource } from "@/lib/clip-archive-source";

const POLL_MS = 30_000;
const RETRY_MS = 5 * 60_000;
const STALE_MS = 60 * 60_000;
const MAX_OBJECT_BYTES = 50 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 800 * 1024 * 1024;
type Admin = ReturnType<typeof createAdminClient>;
type Clip = { id: string; user_id: string; url: string; start_seconds: number; end_seconds: number; archive_status: string };
const log = (...parts: unknown[]) => console.log("[clip-archive]", new Date().toISOString(), ...parts);

async function storedBytes(admin: Admin): Promise<number> {
  let total = 0;
  for (let from = 0; ; from += 500) {
    const { data, error } = await admin.from("clips").select("archive_bytes").eq("archive_status", "stored").range(from, from + 499);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) total += Number(row.archive_bytes) || 0;
    if (!data || data.length < 500) return total;
  }
}

async function claim(admin: Admin, clip: Clip): Promise<boolean> {
  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - (clip.archive_status === "processing" ? STALE_MS : RETRY_MS)).toISOString();
  const { data: created, error: insertError } = await admin.from("clip_archive_jobs")
    .insert({ clip_id: clip.id, status: "processing", updated_at: now }).select("clip_id").maybeSingle();
  if (created) return true;
  if (insertError?.code !== "23505") throw new Error(insertError?.message ?? "Could not claim archive job.");
  // Conditional update is atomic in Postgres: only one worker can revive an old claim.
  const { data: renewed, error } = await admin.from("clip_archive_jobs")
    .update({ status: "processing", updated_at: now }).eq("clip_id", clip.id)
    .in("status", ["failed", "processing"]).lt("updated_at", cutoff)
    .select("clip_id").maybeSingle();
  if (error) throw new Error(error.message);
  return !!renewed;
}

async function uploadIfMissing(admin: Admin, localPath: string, objectPath: string, contentType: string): Promise<number> {
  const bucket = admin.storage.from(CLIP_BUCKET);
  const { data: existing, error: listError } = await bucket.list(path.posix.dirname(objectPath), { limit: 10 });
  if (listError) throw new Error(listError.message);
  const name = path.posix.basename(objectPath);
  const present = existing?.find((entry) => entry.name === name);
  if (present && Number(present.metadata?.size) > 0) return Number(present.metadata?.size);
  const body = await readFile(localPath);
  if (body.byteLength > MAX_OBJECT_BYTES) throw new Error(`${name} exceeds the storage object's 50 MB limit.`);
  const { error } = await bucket.upload(objectPath, body, { contentType, upsert: !!present });
  if (error) throw new Error(`Could not upload ${name}: ${error.message}`);
  return body.byteLength;
}

async function archiveClip(admin: Admin, clip: Clip): Promise<void> {
  if (!(await claim(admin, clip))) return;
  let dir: string | null = null;
  try {
    const { error: processingError } = await admin.from("clips").update({ archive_status: "processing", archive_error: null }).eq("id", clip.id);
    if (processingError) throw new Error(processingError.message);
    dir = await mkdtemp(path.join(tmpdir(), "klyp-archive-"));
    if (!isArchivableSource(clip.url)) throw new Error("Unsupported clip source URL; archive was not attempted.");
    const current = await storedBytes(admin);
    const estimated = (clip.end_seconds - clip.start_seconds) * 0.65 * 1024 * 1024;
    if (current + estimated > MAX_ARCHIVE_BYTES) throw new Error("Archive storage budget reached; this clip is not backed up.");
    const source = await resolveSourceSegment(clip.url, clip.start_seconds, clip.end_seconds);
    const assets = await buildClipArchiveAssets(source.path, source.offsetSeconds, clip.start_seconds, clip.end_seconds, dir);
    const sizes = await Promise.all([stat(assets.master), stat(assets.proxy), stat(assets.poster)]);
    const bytes = sizes.reduce((sum, item) => sum + item.size, 0);
    if (sizes.some((item) => item.size > MAX_OBJECT_BYTES)) throw new Error("Archived clip exceeds the storage object's 50 MB limit.");
    if (current + bytes > MAX_ARCHIVE_BYTES) throw new Error("Archive storage budget reached; this clip is not backed up.");
    const base = `${clip.user_id}/${clip.id}`;
    const master = `${base}/master.mp4`, proxy = `${base}/proxy.mp4`, poster = `${base}/poster.jpg`;
    const uploadedBytes =
      await uploadIfMissing(admin, assets.master, master, "video/mp4") +
      await uploadIfMissing(admin, assets.proxy, proxy, "video/mp4") +
      await uploadIfMissing(admin, assets.poster, poster, "image/jpeg");
    const { error } = await admin.from("clips").update({
      master_path: master, proxy_path: proxy, poster_path: poster,
      archive_status: "stored", archive_error: null, archived_at: new Date().toISOString(), archive_bytes: uploadedBytes,
    }).eq("id", clip.id);
    if (error) throw new Error(error.message);
    await admin.from("clip_archive_jobs").update({ status: "done", last_error: null, updated_at: new Date().toISOString() }).eq("clip_id", clip.id);
    log("stored", clip.id, uploadedBytes, "bytes");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("failed", clip.id, message);
    await admin.from("clips").update({ archive_status: "failed", archive_error: message.slice(0, 300) }).eq("id", clip.id);
    await admin.from("clip_archive_jobs").update({ status: "failed", last_error: message.slice(0, 300), updated_at: new Date().toISOString() }).eq("clip_id", clip.id);
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true });
  }
}

let running = false;
async function poll(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const admin = createAdminClient();
    const { data: pending, error: pendingError } = await admin.from("clips")
      .select("id,user_id,url,start_seconds,end_seconds,archive_status")
      .eq("archive_status", "pending")
      .order("created_at", { ascending: true }).limit(5);
    if (pendingError) throw new Error(pendingError.message);
    const { data: retries, error: retryError } = await admin.from("clips")
      .select("id,user_id,url,start_seconds,end_seconds,archive_status")
      .in("archive_status", ["processing", "failed"])
      .order("created_at", { ascending: true }).limit(5);
    if (retryError) throw new Error(retryError.message);
    for (const clip of [...(pending ?? []), ...(retries ?? [])]) {
      await runQueued(`archive:${clip.id}`, () => archiveClip(admin, clip as Clip));
    }
  } catch (error) {
    log("poll failed", error instanceof Error ? error.message : error);
  } finally {
    running = false;
  }
}

let started = false;
export function startClipArchiveWorker(): void {
  if (started) return;
  started = true;
  log("worker starting");
  setInterval(() => { void poll(); }, POLL_MS);
  void poll();
}
