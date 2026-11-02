/**
 * Server-side video duration — the only duration billing is allowed to trust.
 *
 * The browser used to send a `durationHint` that /api/analyze used for its
 * affordability check (and, on the long-Twitch path, for the final charge), so
 * a client could report a 1-minute video for a 10-hour one. Everything that
 * prices a video now measures it here instead.
 */
import { resolveBin, runCapture } from "@/lib/bin";
import { parseProbedDuration } from "@/lib/duration-limits";

/** Error carrying the HTTP status a route should answer with. */
export class DurationError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

/** Short TTL: a Twitch VOD of a stream still being recorded keeps growing. */
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX_ENTRIES = 500;
const durationCache = new Map<string, { seconds: number; at: number }>();

/** Duration of a YouTube/Twitch URL via yt-dlp metadata (no download). */
export async function probeUrlDuration(url: string): Promise<number> {
  const hit = durationCache.get(url);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.seconds;

  let out: string;
  try {
    out = await runCapture(
      resolveBin("yt-dlp"),
      ["--print", "duration", "--skip-download", "--no-playlist", url],
      { stallTimeoutMs: 30_000, maxRunMs: 60_000 }
    );
  } catch (err) {
    throw new DurationError(
      err instanceof Error ? err.message : "Could not read video duration.",
      500
    );
  }
  const seconds = parseProbedDuration(out);
  if (seconds === null) {
    throw new DurationError("No duration in metadata (is this a live stream?).", 422);
  }

  if (durationCache.size >= CACHE_MAX_ENTRIES) {
    const oldest = durationCache.keys().next().value;
    if (oldest !== undefined) durationCache.delete(oldest);
  }
  durationCache.set(url, { seconds, at: Date.now() });
  return seconds;
}

/** Duration of a local (uploaded) file via ffprobe. */
export async function probeFileDuration(filePath: string): Promise<number> {
  let out: string;
  try {
    out = await runCapture(
      resolveBin("ffprobe"),
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath],
      { stallTimeoutMs: 30_000, maxRunMs: 60_000 }
    );
  } catch (err) {
    throw new DurationError(
      err instanceof Error ? err.message : "Could not read the video's duration.",
      500
    );
  }
  const seconds = parseProbedDuration(out);
  if (seconds === null) {
    throw new DurationError("Could not read the video's duration — is the file a valid video?", 422);
  }
  return seconds;
}
