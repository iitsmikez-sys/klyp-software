/**
 * How long a finished analysis (its clips) can still be opened, previewed and exported before it is saved:
 * 5 days on Free and 30 days on Pro, the same as saved clip footage (migration 032). Pure, no imports.
 */
export const RESULTS_KEPT_DAYS = { free: 5, pro: 30 } as const;
const DAY_MS = 86_400_000;

export const resultsKeptDays = (isPro: boolean): number => (isPro ? RESULTS_KEPT_DAYS.pro : RESULTS_KEPT_DAYS.free);

/** Results from before this moment are too old for this plan. */
export const resultsCutoffIso = (isPro: boolean, now = Date.now()): string =>
  new Date(now - resultsKeptDays(isPro) * DAY_MS).toISOString();

/** Whole days left before an analysis finished at `completedAtIso` stops being available (0 once it is over). */
export function resultsDaysLeft(completedAtIso: string, isPro: boolean, now = Date.now()): number {
  const finished = Date.parse(completedAtIso);
  if (!Number.isFinite(finished)) return 0;
  return Math.max(0, Math.ceil((finished + resultsKeptDays(isPro) * DAY_MS - now) / DAY_MS));
}
