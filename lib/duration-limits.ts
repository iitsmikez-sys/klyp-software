/**
 * Maximum analyzable video length and parsing of probed durations. Pure — no
 * imports — so the cap can be unit-tested without a server or a video.
 */

/** Longest video Klyp will analyze: above this the AI cost per Spark charged
 *  turns unfavourable and downloads start hitting size limits. */
export const MAX_VOD_SECONDS = 8 * 3600;

/** Same slack as DURATION_TOLERANCE_S in lib/sparks.ts: a "8 hour" stream that
 *  probes at 8h00m20s is still an 8 hour stream. */
export const MAX_VOD_TOLERANCE_S = 30;

export function exceedsMaxDuration(durationSeconds: number): boolean {
  return durationSeconds > MAX_VOD_SECONDS + MAX_VOD_TOLERANCE_S;
}

export function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function tooLongMessage(durationSeconds: number): string {
  return (
    `This video is ${formatDuration(durationSeconds)} long. Klyp analyzes videos up to ` +
    `${MAX_VOD_SECONDS / 3600} hours — trim it or split it into parts and try again.`
  );
}

/**
 * Parse the text a probe printed (yt-dlp `--print duration`, ffprobe
 * `format=duration`) into whole seconds. Null for anything that is not a
 * positive finite number — including yt-dlp's "NA" for live streams.
 */
export function parseProbedDuration(raw: string): number | null {
  const n = Math.round(Number(raw.trim()));
  return Number.isFinite(n) && n > 0 ? n : null;
}
