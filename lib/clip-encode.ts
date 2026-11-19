/**
 * How a finished clip is encoded. "veryfast" with CRF 21 builds the clip in well under two thirds of the time "fast" with CRF 18
 * did, and the file is about 30% smaller (so it also downloads sooner). Both can be changed with CLIP_PRESET and CLIP_CRF on the
 * processing service without a code change, in case the picture ever needs to go back to higher quality.
 */
const PRESETS = ["ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow"];

export function clipPreset(env: Record<string, string | undefined> = process.env): string {
  const value = env.CLIP_PRESET?.trim();
  return value && PRESETS.includes(value) ? value : "veryfast";
}

export function clipCrf(env: Record<string, string | undefined> = process.env): string {
  const value = Number(env.CLIP_CRF);
  return Number.isInteger(value) && value >= 14 && value <= 28 ? String(value) : "21";
}
