/**
 * The $17 first-month offer is for people who arrive from the ad link (`/?offer=17`). The site saves that
 * in a cookie for 30 days so it survives signing up and confirming an email. No imports on purpose: the
 * request proxy loads this file.
 */
export const OFFER_COOKIE = "klyp_offer";
export const OFFER_VALUE = "17";
export const OFFER_PARAM = "offer";
export const OFFER_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

/**
 * Links can carry an end date: `/?offer=17&until=2026-11-09`. The $17 works until the end of that day
 * (US Pacific, UTC-8) and then the link stops giving it. Links without `until` (the ads) never expire.
 */
export const OFFER_UNTIL_PARAM = "until";

/** End of the given YYYY-MM-DD day in US Pacific (UTC-8), in ms, or null when it is not a real date. */
export function offerDeadlineMs(until: string | null | undefined): number | null {
  if (!until || !/^\d{4}-\d{2}-\d{2}$/.test(until)) return null;
  const ms = Date.parse(`${until}T23:59:59-08:00`);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * What to save in the cookie for a visit to the offer link: "17" (no end date), "17|<deadline ms>",
 * or null when the link's end date has passed or is not a real date.
 */
export function offerCookieValueFor(until: string | null | undefined, now = Date.now()): string | null {
  if (until === null || until === undefined || until === "") return OFFER_VALUE;
  const deadline = offerDeadlineMs(until);
  if (deadline === null || now > deadline) return null;
  return `${OFFER_VALUE}|${deadline}`;
}

/** Is a saved cookie still a live offer? */
export function offerCookieActive(value: string | null | undefined, now = Date.now()): boolean {
  if (!value) return false;
  if (value === OFFER_VALUE) return true;
  const m = /^17\|(\d{10,15})$/.exec(value);
  return m !== null && now <= Number(m[1]);
}
