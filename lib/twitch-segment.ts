import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isTwitchVodRef } from "@/lib/video-segment";
import { FFMPEG_THREADS, ffmpegLocationArgs, resolveBin, run } from "@/lib/bin";

const execFileAsync = promisify(execFile);

/**
 * Cut [start, end] out of a Twitch VOD with ffmpeg reading the stream directly. yt-dlp's own
 * --download-sections cut fails on the production server (ffmpeg gets no packets from it) even
 * though plain ffmpeg reads the same stretch fine, so for Twitch we ask yt-dlp only for the
 * stream URL (one muxed rendition, picture and sound together) and do the cut ourselves.
 * The result starts exactly at `startSeconds`, like the --force-keyframes-at-cuts download.
 * Throws when yt-dlp returns anything but a single muxed URL, so the caller can fall back.
 */
export async function fetchTwitchSegment(opts: {
  ref: string; maxHeight: number; startSeconds: number; endSeconds: number; outPath: string; maxRunMs: number;
}): Promise<void> {
  const { stdout } = await execFileAsync(resolveBin("yt-dlp"),
    ["-g", "-f", `b[height<=${opts.maxHeight}]/b`, "--no-playlist", "--socket-timeout", "30", ...ffmpegLocationArgs(), opts.ref],
    { timeout: 60_000, maxBuffer: 256 * 1024 });
  const urls = stdout.split(/\r?\n/).map((u) => u.trim()).filter(Boolean);
  if (urls.length !== 1) throw new Error(`Twitch returned ${urls.length} stream URLs, expected one muxed stream`);
  await run(resolveBin("ffmpeg"), [
    "-hide_banner", "-loglevel", "error",
    "-ss", String(opts.startSeconds), "-t", String(opts.endSeconds - opts.startSeconds), "-i", urls[0],
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
    "-threads", String(FFMPEG_THREADS), "-y", opts.outPath,
  ], { stallTimeoutMs: Math.min(90_000, opts.maxRunMs), maxRunMs: opts.maxRunMs });
}
