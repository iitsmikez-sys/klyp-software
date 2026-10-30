/** Archives queued clips in the private clip-media bucket on the processing service. */
import { mkdtemp, readFile, rm, stat } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { createAdminClient } from "@/lib/supabase/admin";
import { FFMPEG_THREADS, resolveBin, run } from "@/lib/bin";
import { resolveSourceSegment } from "@/lib/video-cache";
import { archiveScaleFilter } from "@/lib/archive-video";
import { CLIP_BUCKET } from "@/lib/clip-archive";
import { runQueued } from "@/lib/job-queue";
import { archiveUsageEvent } from "@/lib/analysis-meter";
import { vodSourceKey } from "@/lib/vod-source";

const MAX_OBJECT_BYTES = 50 * 1024 * 1024;
type ArchiveJob = {
  clip_id: string; user_id: string; url: string;
  start_seconds: number; end_seconds: number; attempts: number;
};

async function makeAssets(job: ArchiveJob, dir: string) {
  const sourceStart = Math.floor(job.start_seconds);
  const sourceEnd = Math.ceil(job.end_seconds);
  const { path: source, offsetSeconds } = await resolveSourceSegment(
    job.url, sourceStart, sourceEnd, 1080
  );
  const start = Math.max(0, sourceStart - offsetSeconds);
  const duration = sourceEnd - sourceStart;
  const master = path.join(dir, "master.mp4");
  const proxy = path.join(dir, "proxy.mp4");
  const poster = path.join(dir, "poster.jpg");
  const encode = async (output: string, height: number, crf: number, bitrate?: string) => run(resolveBin("ffmpeg"), [
    "-ss", String(start), "-t", String(duration), "-i", source,
    "-vf", archiveScaleFilter(height),
    "-c:v", "libx264", "-preset", "veryfast",
    "-threads", String(FFMPEG_THREADS),
    ...(bitrate ? ["-b:v", bitrate, "-maxrate", bitrate, "-bufsize", "3000k"] : ["-crf", String(crf)]),
    "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", "-y", output,
  ], { stallTimeoutMs: 30_000, maxRunMs: 10 * 60_000 });
  await encode(master, 1080, 25);
  // Supabase's Free tier rejects objects over 50 MB. Retry a compact master
  // instead of leaving a long clip permanently unarchived.
  if ((await stat(master)).size > MAX_OBJECT_BYTES) await encode(master, 720, 30);
  if ((await stat(master)).size > MAX_OBJECT_BYTES) await encode(master, 720, 30, "1500k");
  await encode(proxy, 540, 28);
  await run(resolveBin("ffmpeg"), [
    "-ss", String(start + duration / 2), "-i", source,
    "-frames:v", "1", "-q:v", "4", "-y", poster,
  ], { stallTimeoutMs: 30_000, maxRunMs: 2 * 60_000 });
  return { master, proxy, poster };
}

async function archiveOne(job: ArchiveJob): Promise<void> {
  const startedAt = Date.now();
  const admin = createAdminClient();
  const dir = await mkdtemp(path.join(tmpdir(), "klyp-archive-"));
  try {
    const assets = await runQueued(`archive:${job.clip_id}`, () => makeAssets(job, dir));
    const base = `${job.user_id}/${job.clip_id}`;
    let bytes = 0;
    for (const [name, local, contentType] of [
      ["master.mp4", assets.master, "video/mp4"],
      ["proxy.mp4", assets.proxy, "video/mp4"],
      ["poster.jpg", assets.poster, "image/jpeg"],
    ]) {
      const data = await readFile(local);
      if (data.byteLength > MAX_OBJECT_BYTES) throw new Error(`${name} exceeds the media storage size limit`);
      const { error } = await admin.storage.from(CLIP_BUCKET).upload(`${base}/${name}`, data,
        { contentType, upsert: true });
      if (error) throw error;
      bytes += data.byteLength;
    }
    const { error } = await admin.rpc("finish_clip_archive_job", {
      p_clip_id: job.clip_id,
      p_master: `${base}/master.mp4`, p_proxy: `${base}/proxy.mp4`,
      p_poster: `${base}/poster.jpg`, p_bytes: bytes,
    });
    if (error) throw error;
    console.log("[clip-archive] stored", job.clip_id, bytes);
    console.log(`[analysis-archive] ${JSON.stringify(archiveUsageEvent(vodSourceKey(job.url), job.clip_id, bytes, Date.now() - startedAt))}`);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

let running = false;
export async function processClipArchiveJobs(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("claim_clip_archive_job");
    if (error) throw error;
    const job = (data as ArchiveJob[] | null)?.[0];
    if (!job) return;
    try {
      await archiveOne(job);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const sourceGone = /uploaded file is no longer available|video unavailable|HTTP(?: Error)? (404|410)|source video no longer available/i.test(message);
      const { error: failError } = await admin.rpc("fail_clip_archive_job", {
        p_clip_id: job.clip_id, p_error: message,
        p_retry_seconds: Math.min(86400, 120 * 2 ** Math.min(job.attempts - 1, 10)),
        p_source_gone: sourceGone,
      });
      if (failError) throw failError;
      console.error("[clip-archive] failed", job.clip_id, message);
    }
  } finally {
    running = false;
  }
}
