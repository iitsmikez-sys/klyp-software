type Window = { source_key: string | null; start_seconds: number; end_seconds: number };

/** A requested trim may shorten a paid clip, but never extend outside it. */
export function withinClipWindow(requested: Window, allowed: Window): boolean {
  return !!requested.source_key && requested.source_key === allowed.source_key &&
    requested.start_seconds >= allowed.start_seconds - 0.001 &&
    requested.end_seconds <= allowed.end_seconds + 0.001;
}

// Next builds each route as a separate module graph. Use the process global so
// /clip, /preview, /thumbnail and /duration share one account budget.
const shared = globalThis as typeof globalThis & { __klypInFlight?: Map<string, number> };
const inFlight = shared.__klypInFlight ??= new Map<string, number>();
const MAX_PER_USER = 3;

/** Counts running and queued work on the single processing instance. */
export function acquireUserProcessingSlot(userId: string): (() => void) | null {
  const current = inFlight.get(userId) ?? 0;
  if (current >= MAX_PER_USER) return null;
  inFlight.set(userId, current + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const remaining = (inFlight.get(userId) ?? 1) - 1;
    if (remaining <= 0) inFlight.delete(userId);
    else inFlight.set(userId, remaining);
  };
}
