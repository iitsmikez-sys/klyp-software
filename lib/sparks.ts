/** Sparks — Klyp's usage currency. Balances live in Supabase (profiles.sparks). */

/**
 * Cheapest possible analysis — used as the "can you afford anything at all"
 * floor: shortest VOD (10⚡) + fewest clips (10⚡).
 */
export const MIN_ANALYZE_COST = 20;

/** Selectable clip counts and their Sparks cost (added to the VOD length cost). */
export const CLIP_COUNT_OPTIONS = [3, 5, 7, 10] as const;
export type ClipCount = (typeof CLIP_COUNT_OPTIONS)[number];
export const CLIP_COUNT_COST: Record<ClipCount, number> = { 3: 10, 5: 20, 7: 30, 10: 40 };
export const DEFAULT_CLIP_COUNT: ClipCount = 5;

/**
 * Clip-count portion of the charge, prorated by how many clips actually came
 * back — MIDAS only returns moments above the quality floor, so asking for 10
 * and getting 4 charges 4 × (40/10) = 16⚡.
 */
export function clipCharge(requested: ClipCount, returned: number): number {
  const perClip = CLIP_COUNT_COST[requested] / requested;
  return Math.round(perClip * Math.max(0, Math.min(returned, requested)));
}


/** Flat Sparks cost of a 2× upscaled export (Pro only). */
export const UPSCALE_COST = 35;

/** Sparks cost of analyzing a VOD, tiered by duration. */
export function estimateSparks(durationSeconds: number): number {
  const minutes = durationSeconds / 60;
  if (minutes < 30) return 10;
  if (minutes < 60) return 20;
  if (minutes < 120) return 35;
  return 50;
}
