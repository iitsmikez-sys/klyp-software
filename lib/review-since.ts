const DEFAULT_DAYS = 3;

/** The start of the clips the review page shows: the time in the email link, or the last 3 days when it is missing, bad or in the future. */
export function reviewSince(raw: string | null, now: number = Date.now()): string {
  const parsed = raw ? Date.parse(raw) : NaN;
  const fallback = now - DEFAULT_DAYS * 86_400_000;
  return new Date(Number.isFinite(parsed) && parsed <= now ? parsed : fallback).toISOString();
}
