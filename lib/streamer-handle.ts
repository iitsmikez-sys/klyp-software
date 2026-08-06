"use client";

/**
 * The streamer handle burned into exports (top-right corner, see handleFilter
 * in app/api/clip/route.ts). Entered in the analyze form or Settings and
 * persisted locally — every export path reads it from here so a new one can't
 * quietly forget to send it, which is exactly how saved-clip exports ended up
 * missing the overlay.
 */
export const HANDLE_STORAGE_KEY = "klyp-handle";

/** Reduce to the charset /api/clip accepts, so a stale odd value is dropped
 *  here rather than being silently ignored server-side. */
export function sanitizeHandle(raw: string): string {
  return raw.replace(/^@/, "").replace(/[^A-Za-z0-9_]/g, "").slice(0, 25);
}

/** Saved handle, or undefined when unset — shape matches the API's optional field. */
export function getStoredHandle(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const clean = sanitizeHandle(localStorage.getItem(HANDLE_STORAGE_KEY) ?? "");
  return clean || undefined;
}
