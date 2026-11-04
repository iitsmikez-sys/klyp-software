/** Sparks — Klyp's usage currency. Balances live in Supabase (profiles.sparks). */

/**
 * Cheapest possible analysis — used as the "can you afford anything at all"
 * floor: the shortest video's price (20⚡).
 */
export const MIN_ANALYZE_COST = 20;

/**
 * Every analysis looks for up to this many clips. Clip count no longer changes the price (it barely
 * changes Klyp's cost): the charge is per video, by length. Only moments that clear the quality
 * floor are returned and saved, so fewer than 10 come back when the video has fewer good ones.
 */
export const CLIP_COUNT_OPTIONS = [10] as const;
/** Wider than the options: older jobs and the internal candidate pool (20) still carry other counts. */
export type ClipCount = 1 | 2 | 3 | 5 | 7 | 10 | 12 | 20;
/** Kept so older callers keep working: clips are included in the video price. */
export const CLIP_COUNT_COST: Record<ClipCount, number> = { 1: 0, 2: 0, 3: 0, 5: 0, 7: 0, 10: 0, 12: 0, 20: 0 };
export const DEFAULT_CLIP_COUNT: ClipCount = 10;
export const MAX_CLIP_COUNT: ClipCount = 10;

/** Clips are included in the video price, so a returned clip adds no charge. */
export function clipCharge(_requested: ClipCount, _returned: number): number {
  return 0;
}

/** Flat Sparks cost of a 2× upscaled export (Pro only). */
export const UPSCALE_COST = 35;

/** Videos up to this long cost the flat top tier (80); beyond it each started hour adds LONG_VIDEO_SPARKS_PER_HOUR. */
export const LONG_VIDEO_FROM_SECONDS = 6 * 3600;
export const LONG_VIDEO_SPARKS_PER_HOUR = 20;

/**
 * Sparks cost of analyzing a video, by length, with its clips included. Must match v_vod_cost in
 * record_analysis_clips (migration 039): 20 / 35 / 50 / 65 (2-4h) / 80 (4-6h), then +20 per started hour over 6.
 */
export function estimateSparks(durationSeconds: number): number {
  const minutes = durationSeconds / 60;
  if (minutes < 30) return 20;
  if (minutes < 60) return 35;
  if (minutes < 120) return 50;
  if (durationSeconds <= 4 * 3600) return 65;
  if (durationSeconds <= LONG_VIDEO_FROM_SECONDS) return 80;
  return 80 + LONG_VIDEO_SPARKS_PER_HOUR * Math.ceil((durationSeconds - LONG_VIDEO_FROM_SECONDS) / 3600);
}

/**
 * What an analysis charges once its result is known: the full video price when at least one clip
 * came back, nothing when the video was analyzed but nothing cleared the quality floor (same as manual runs).
 */
export function analysisCharge(durationSeconds: number, clipsReturned: number): number {
  const full = estimateSparks(durationSeconds);
  return clipsReturned > 0 ? full : 0;
}

/**
 * A representative run: a 45-minute VOD. Used only to
 * translate a Sparks balance into something a human can picture ("about 3
 * VODs"). Deliberately derived from the real cost functions rather than a
 * hardcoded guess, so it cannot drift when pricing changes.
 */
export const TYPICAL_ANALYSIS_COST =
  estimateSparks(45 * 60);

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
