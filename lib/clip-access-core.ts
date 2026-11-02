type Window = { source_key: string | null; start_seconds: number; end_seconds: number };

/** A requested trim may shorten a paid clip, but never extend outside it. */
export function withinClipWindow(requested: Window, allowed: Window): boolean {
  return !!requested.source_key && requested.source_key === allowed.source_key &&
    requested.start_seconds >= allowed.start_seconds - 0.001 &&
    requested.end_seconds <= allowed.end_seconds + 0.001;
}

/** A raw download is the detected moment, never a user-selected subrange. */
export function sameClipWindow(requested: Window, allowed: Window): boolean {
  return !!requested.source_key && requested.source_key === allowed.source_key &&
    Math.abs(requested.start_seconds - allowed.start_seconds) <= 0.001 &&
    Math.abs(requested.end_seconds - allowed.end_seconds) <= 0.001;
}

// Next builds each route as a separate module graph. Use the process global so
// /clip, /preview, /thumbnail and /duration share one account budget.
const shared = globalThis as typeof globalThis & {
  __klypInFlight?: Map<string, number>;
  __klypScopedInFlight?: Map<string, Map<string, number>>;
};
const inFlight = shared.__klypInFlight ??= new Map<string, number>();
const MAX_PER_USER = 3;

const scopedInFlight = (shared.__klypScopedInFlight ??= new Map<string, Map<string, number>>());

/**
 * Counts running and queued work on the single processing instance.
 *
 * With no options it is the shared per-account budget (3). A `scope` gets its own
 * counter and `max`, e.g. { scope: "analysis", max: 1 } for one paid analysis at
 * a time without touching how many exports/previews an account can run.
 */
export function acquireUserProcessingSlot(
  userId: string,
  options: { scope?: string; max?: number } = {}
): (() => void) | null {
  const counter = options.scope
    ? (scopedInFlight.get(options.scope) ?? scopedInFlight.set(options.scope, new Map()).get(options.scope)!)
    : inFlight;
  const limit = options.scope ? Math.max(1, options.max ?? MAX_PER_USER) : MAX_PER_USER;
  const current = counter.get(userId) ?? 0;
  if (current >= limit) return null;
  counter.set(userId, current + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const remaining = (counter.get(userId) ?? 1) - 1;
    if (remaining <= 0) counter.delete(userId);
    else counter.set(userId, remaining);
  };
}
