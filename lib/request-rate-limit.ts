/**
 * Small in-memory sliding-window limiter for cheap per-user routes. In-process only:
 * it resets on restart and is not shared between instances — fine as a guard against
 * a stuck client hammering Stripe, not a security boundary.
 */
const hits = new Map<string, number[]>();
const MAX_KEYS = 5000;

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

export function rateLimit(key: string, limit: number, windowMs: number, now: number = Date.now()): RateLimitResult {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000)) };
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > MAX_KEYS) {
    const oldest = hits.keys().next().value;
    if (oldest !== undefined) hits.delete(oldest);
  }
  return { ok: true };
}

/** Test helper. */
export function resetRateLimits(): void {
  hits.clear();
}
