/**
 * How long saved clip footage is kept: 5 days on Free, 30 days on Pro (set by the database when the clip is backed up,
 * see migration 032). After that date the footage is gone and the clip cannot be previewed, exported or downloaded.
 * Pure functions, no imports, shared by the server checks and the library page.
 */
export type MediaRow = { archive_status?: string | null; media_expires_at?: string | null };

/** The footage is expired when it was marked expired, or its expiry date has passed (even if cleanup has not run yet). */
export function isMediaExpired(row: MediaRow | null | undefined, now = Date.now()): boolean {
  if (!row) return false;
  if (row.archive_status === "expired") return true;
  if (!row.media_expires_at) return false;
  const at = Date.parse(row.media_expires_at);
  return Number.isFinite(at) && at <= now;
}

/** Shown when the footage is this close to being deleted. */
export const EXPIRY_WARNING_DAYS = 2;

export type VodExpiry =
  | { kind: "none" }
  | { kind: "ok" | "soon"; daysLeft: number }
  | { kind: "expired" };

const DAY_MS = 86_400_000;

/**
 * The expiry state of one VOD's clips: expired once every saved clip has expired, otherwise how long until the
 * soonest one goes. Clips with no expiry date (older saves) are ignored.
 */
export function vodExpiry(clips: readonly MediaRow[], now = Date.now()): VodExpiry {
  const dated = clips.filter((c) => c.archive_status === "expired" || !!c.media_expires_at);
  if (dated.length === 0) return { kind: "none" };
  const live = dated.filter((c) => !isMediaExpired(c, now));
  if (live.length === 0) return { kind: "expired" };
  const times = live.map((c) => Date.parse(c.media_expires_at ?? "")).filter(Number.isFinite);
  if (times.length === 0) return { kind: "none" };
  const daysLeft = Math.max(1, Math.ceil((Math.min(...times) - now) / DAY_MS));
  return { kind: daysLeft <= EXPIRY_WARNING_DAYS ? "soon" : "ok", daysLeft };
}

export const dayWord = (n: number) => `${n} day${n === 1 ? "" : "s"}`;
