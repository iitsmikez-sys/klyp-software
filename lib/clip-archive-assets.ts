import path from "node:path";
import { FFMPEG_THREADS, resolveBin, run } from "./bin.ts";

/** Produce a durable clean source, lightweight preview, and representative frame. */
export async function buildClipArchiveAssets(
  sourcePath: string,
  sourceOffsetSeconds: number,
  startSeconds: number,
  endSeconds: number,
  outputDir: string
): Promise<{ master: string; proxy: string; poster: string }> {
  const seek = startSeconds - sourceOffsetSeconds;
  const duration = endSeconds - startSeconds;
  if (!Number.isFinite(seek) || !Number.isFinite(duration) || seek < 0 || duration <= 0 || duration > 180) {
    throw new Error("Invalid archive clip timestamps.");
  }
  const master = path.join(outputDir, "master.mp4");
  const proxy = path.join(outputDir, "proxy.mp4");
  const poster = path.join(outputDir, "poster.jpg");
  const ffmpeg = resolveBin("ffmpeg");
  const common = ["-hide_banner", "-loglevel", "error", "-threads", String(FFMPEG_THREADS), "-ss", String(seek), "-i", sourcePath, "-t", String(duration)];
  const options = { stallTimeoutMs: 60_000, maxRunMs: 7 * 60_000 };
  await run(ffmpeg, [...common, "-c:v", "libx264", "-crf", "23", "-preset", "medium", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "-y", master], options);
  await run(ffmpeg, [...common, "-vf", "scale=-2:540", "-c:v", "libx264", "-crf", "26", "-preset", "veryfast", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", "-y", proxy], options);
  await run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-ss", String(seek + duration / 2), "-i", sourcePath, "-frames:v", "1", "-q:v", "4", "-y", poster], options);
  return { master, proxy, poster };
}
