/** Sparks — Klyp's usage currency. Balances live in Supabase (profiles.sparks). */

/**
 * Cheapest possible analysis — used as the "can you afford anything at all"
 * floor: shortest VOD (10⚡) + fewest clips (10⚡).
 */
export const MIN_ANALYZE_COST = 20;

/** Selectable clip counts and their Sparks cost (added to the VOD length cost). */
export const CLIP_COUNT_OPTIONS = [3, 5, 7, 10, 12, 20] as const;
export type ClipCount = (typeof CLIP_COUNT_OPTIONS)[number];
export const CLIP_COUNT_COST: Record<ClipCount, number> = { 3: 10, 5: 20, 7: 30, 10: 40, 12: 50, 20: 80 };
export const DEFAULT_CLIP_COUNT: ClipCount = 5;
/** The MAX tier — priciest run; the UI requires explicit confirmation before analyzing. */
export const MAX_CLIP_COUNT: ClipCount = 20;

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

/** From this length up, the flat tiers below stop and per-hour pricing starts. */
export const LONG_VOD_THRESHOLD_S = 2 * 3600;
/** Cost of a VOD at exactly the long-VOD threshold. */
export const LONG_VOD_BASE_SPARKS = 50;
/** Added for each hour beyond the threshold, prorated by the second. */
export const EXTRA_HOUR_SPARKS = 15;
/**
 * Probe and encoder durations of the same file disagree by a few seconds, so
 * this much past a boundary is treated as sitting on it — 2h00m20s is not
 * billed as a second tier. Applied to the 2h threshold only.
 */
export const DURATION_TOLERANCE_S = 30;

/**
 * Sparks cost of analyzing a VOD. Under 2 hours it is tiered by duration;
 * from 2 hours it is 50 plus 15 per additional hour, prorated by the second and
 * rounded UP to a whole Spark (so 3h costs 65, 4h costs 80, 8h costs 140).
 *
 * Duration must be server-verified — never a client-supplied hint. A value
 * that is not a positive finite number is billed as the cheapest tier here;
 * callers refuse such videos before this is reached (see lib/probe-duration.ts).
 */
export function estimateSparks(durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 10;
  const minutes = durationSeconds / 60;
  if (minutes < 30) return 10;
  if (minutes < 60) return 20;
  if (minutes < 120) return 35;
  const over = durationSeconds - LONG_VOD_THRESHOLD_S - DURATION_TOLERANCE_S;
  const extra = over > 0 ? Math.ceil((EXTRA_HOUR_SPARKS * over) / 3600) : 0;
  return LONG_VOD_BASE_SPARKS + extra;
}

/**
 * A representative run: a 45-minute VOD at the default clip count. Used only to
 * translate a Sparks balance into something a human can picture ("about 3
 * VODs"). Deliberately derived from the real cost functions rather than a
 * hardcoded guess, so it cannot drift when pricing changes.
 */
export const TYPICAL_ANALYSIS_COST =
  estimateSparks(45 * 60) + CLIP_COUNT_COST[DEFAULT_CLIP_COUNT];

/** Whole VODs a balance can cover at the typical cost. Rounds down — promising
 *  a run the balance can't finish is worse than understating. */
export function vodsAffordable(sparks: number): number {
  return Math.floor(sparks / TYPICAL_ANALYSIS_COST);
}

/** "about 3 VODs" / "not enough for a full VOD" — plain-language balance. */
export function vodsPhrase(sparks: number): string {
  const n = vodsAffordable(sparks);
  if (n < 1) return "not enough for a full VOD";
  return `about ${n} ${n === 1 ? "VOD" : "VODs"}`;
}

/**
 * "refills today" / "refills in 6 days" from profiles.sparks_reset_at.
 *
 * The reset is a rolling 30 days from the last one (see get_profile in
 * migration 001), not a calendar month — so a date is the honest thing to
 * show, and "per month" copy elsewhere was misleading.
 */
export function refillPhrase(resetAt: string | null | undefined): string | null {
  if (!resetAt) return null;
  const ms = new Date(resetAt).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  const days = Math.ceil(ms / 86_400_000);
  if (days <= 0) return "refills on your next visit";
  if (days === 1) return "refills tomorrow";
  return `refills in ${days} days`;
}
