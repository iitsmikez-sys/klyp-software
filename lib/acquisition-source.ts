/**
 * Where a visitor came from, remembered for 90 days so it can be saved on their account when they sign up.
 * "First touch" means the first real source wins; a later visit never overwrites it (except that a plain
 * "direct" visit is replaced by a real source, so typing the address once doesn't hide a TikTok click).
 * Only a short source name is kept (like "tiktok" or "meta"), nothing personal. No imports on purpose:
 * the request proxy loads this file.
 */
export const SOURCE_COOKIE = "klyp_src";
export const SOURCE_COOKIE_MAX_AGE = 60 * 60 * 24 * 90;
export const SOURCE_PARAMS = ["src", "utm_source"] as const;
export const DIRECT_SOURCE = "direct";
/** Saved when a new account had no source cookie (for example cookies were blocked). */
export const UNKNOWN_SOURCE = "unknown";
const MAX_SOURCE_LENGTH = 32;

/** Lowercase letters, digits, dot, dash and underscore only, so a source can never carry anything else. */
export function cleanSource(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.toLowerCase().trim().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, MAX_SOURCE_LENGTH);
  return cleaned || null;
}

/** Friendly names for well-known referrer sites. Anything else is shown as its own domain. */
const REFERRER_NAMES: [RegExp, string][] = [
  [/(^|\.)tiktok\.com$/, "tiktok"],
  [/(^|\.)twitch\.tv$/, "twitch"],
  [/(^|\.)google\.[a-z.]+$/, "google"],
  [/(^|\.)bing\.com$/, "bing"],
  [/(^|\.)duckduckgo\.com$/, "duckduckgo"],
  [/(^|\.)(youtube\.com|youtu\.be)$/, "youtube"],
  [/(^|\.)(discord\.com|discordapp\.com|discord\.gg)$/, "discord"],
  [/(^|\.)reddit\.com$/, "reddit"],
  [/(^|\.)(x\.com|twitter\.com|t\.co)$/, "x"],
  [/(^|\.)(facebook\.com|fb\.com|fb\.me)$/, "facebook"],
  [/(^|\.)instagram\.com$/, "instagram"],
];

export function sourceFromReferrer(referrer: string | null | undefined, ownHost: string | null | undefined): string | null {
  if (!referrer) return null;
  let host: string;
  try { host = new URL(referrer).hostname.toLowerCase(); } catch { return null; }
  if (!host) return null;
  const own = (ownHost ?? "").toLowerCase().split(":")[0];
  const strip = (h: string) => h.replace(/^www\./, "");
  if (own && strip(host) === strip(own)) return null; // came from inside Klyp
  for (const [pattern, name] of REFERRER_NAMES) if (pattern.test(host)) return name;
  return cleanSource(strip(host));
}

/** The source for this visit: a tagged link wins, then the $17 ad link, then the referring site, then direct. */
export function sourceFromVisit(search: URLSearchParams, referrer: string | null | undefined, ownHost: string | null | undefined): string {
  for (const param of SOURCE_PARAMS) {
    const tagged = cleanSource(search.get(param));
    if (tagged) return tagged;
  }
  if (search.get("offer") === "17") return "offer-17";
  return sourceFromReferrer(referrer, ownHost) ?? DIRECT_SOURCE;
}

/** Whether to store this visit's source: when nothing is saved yet, or only "direct" is saved and this is better. */
export function shouldSaveSource(existing: string | null | undefined, visit: string): boolean {
  if (!existing) return true;
  return existing === DIRECT_SOURCE && visit !== DIRECT_SOURCE;
}
