/**
 * A stream that is still live can only be downloaded as fast as it is being made: the progress line says "speed=1.04x" (the video
 * arrives at about its own playing speed). Waiting out a download like that for the full 10 minute limit helps nobody, so it is
 * stopped after about a minute with a plain message. Pure functions, no imports, so the rule can be tested on its own.
 */
export const LIVE_DOWNLOAD_REASON = "is downloading only as fast as the stream plays (it is probably still live)";

/** Wait this long before judging, so a slow start is not mistaken for a live stream. */
export const LIVE_CHECK_AFTER_MS = 60_000;
/** Real time, plus or minus: every reading must be this close to 1x. */
export const LIVE_SPEED_MIN = 0.8;
export const LIVE_SPEED_MAX = 1.5;
/** Only stop it if finishing at this pace would take longer than this. */
export const LIVE_MIN_REMAINING_SECONDS = 600;

type Reading = { mediaSeconds: number; speed: number };

/** The progress lines ffmpeg prints while it downloads: "time=00:10:20.01 ... speed=1.04x". */
export function readProgress(stderr: string): Reading[] {
  const out: Reading[] = [];
  for (const match of stderr.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)[^\r\n]*?speed=\s*([0-9]+(?:\.[0-9]+)?)x/gi)) {
    out.push({ mediaSeconds: Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]), speed: Number(match[4]) });
  }
  return out;
}

/**
 * True when the download has run for a while, has been going at almost exactly the video's playing speed the whole time,
 * and would take a long time more to finish. `expectedSeconds` is the video's length; without it nothing is ever stopped.
 */
export function liveDownloadDetected(stderr: string, elapsedMs: number, expectedSeconds: number | undefined): boolean {
  if (!expectedSeconds || !Number.isFinite(expectedSeconds) || expectedSeconds <= 0) return false;
  if (elapsedMs < LIVE_CHECK_AFTER_MS) return false;
  const readings = readProgress(stderr);
  if (readings.length < 4) return false;
  const recent = readings.slice(-6);
  if (!recent.every((r) => r.speed >= LIVE_SPEED_MIN && r.speed <= LIVE_SPEED_MAX)) return false;
  const last = recent[recent.length - 1];
  if (last.mediaSeconds < 30) return false;
  const average = recent.reduce((sum, r) => sum + r.speed, 0) / recent.length;
  const remainingSeconds = Math.max(0, expectedSeconds - last.mediaSeconds) / average;
  return remainingSeconds > LIVE_MIN_REMAINING_SECONDS;
}
