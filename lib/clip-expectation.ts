/**
 * How many clips a video can sensibly give. The requested number (10) is a ceiling, not a promise:
 * Klyp only returns moments worth posting, and a short video simply has fewer of them.
 * Roughly one clip per 10 minutes, never more than the requested number, never fewer than 1.
 * This is only wording for the screen. It never changes how many clips are requested.
 */
export const MINUTES_PER_CLIP = 10;

export function expectedClipCeiling(requested: number, durationSeconds: number | null | undefined): number {
  if (!Number.isFinite(requested) || requested < 1) return 1;
  if (durationSeconds == null || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return requested;
  const byLength = Math.max(1, Math.ceil(durationSeconds / 60 / MINUTES_PER_CLIP));
  return Math.min(requested, byLength);
}

export const upToClipsText = (n: number) => `Up to ${n} clip${n === 1 ? "" : "s"}`;
