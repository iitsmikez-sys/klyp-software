/** Sparks — Klyp's usage currency. Balances live in Supabase (profiles.sparks). */

/** Cheapest possible analysis — used as the "can you afford anything at all" floor. */
export const MIN_ANALYZE_COST = 10;

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
