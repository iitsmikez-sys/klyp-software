/**
 * Remembers, for a few minutes, which YouTube videos YouTube just refused to give the server.
 * A blocked video is tried several ways (normal, IPv6, other app clients); without this, every repeat request for the
 * same video runs all of them again and floods the logs. A short memory fails repeats fast. It is short on purpose:
 * blocks come and go, so the video is tried again soon.
 */
export const BLOCK_MEMORY_MS = 3 * 60_000;
const MAX_REMEMBERED = 200;

const blocked = new Map<string, { until: number; message: string }>();

/** The 11 character video id in any of the argument strings, or null. */
export function youtubeVideoId(args: readonly string[]): string | null {
  for (const arg of args) {
    const match = /(?:youtube\.com\/(?:watch\?(?:[^#\s]*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/.exec(arg);
    if (match) return match[1];
  }
  return null;
}

export function rememberBlockedVideo(args: readonly string[], message: string, now = Date.now()): void {
  const id = youtubeVideoId(args);
  if (!id) return;
  if (blocked.size >= MAX_REMEMBERED) for (const [key, entry] of blocked) if (entry.until <= now) blocked.delete(key);
  if (blocked.size >= MAX_REMEMBERED) blocked.delete(blocked.keys().next().value as string);
  blocked.set(id, { until: now + BLOCK_MEMORY_MS, message });
}

/** The error from the last refusal if this video was refused moments ago, otherwise null. */
export function recentlyBlockedMessage(args: readonly string[], now = Date.now()): string | null {
  const id = youtubeVideoId(args);
  if (!id) return null;
  const entry = blocked.get(id);
  if (!entry) return null;
  if (entry.until <= now) { blocked.delete(id); return null; }
  return entry.message;
}

export function forgetBlockedVideo(args: readonly string[]): void {
  const id = youtubeVideoId(args);
  if (id) blocked.delete(id);
}

/**
 * When YouTube answers "429 Too Many Requests", every further request only makes the cooldown longer. Klyp stops asking
 * YouTube for a while (all YouTube links, not just that video) and gives the plain message straight away.
 */
export const RATE_LIMIT_COOLDOWN_MS = 10 * 60_000;
export const YOUTUBE_COOLDOWN_MESSAGE = "YouTube is limiting downloads right now. Try again in a few minutes, or use a Twitch or Kick link.";
const RATE_LIMITED = /HTTP Error 429|Too Many Requests/i;
const YOUTUBE_LINK = /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\//i;
let cooldownUntil = 0;

export const isYoutubeRateLimit = (message: string): boolean => RATE_LIMITED.test(message);
export const isYoutubeRequest = (args: readonly string[]): boolean => args.some((arg) => YOUTUBE_LINK.test(arg));

export function startYoutubeCooldown(now = Date.now()): void {
  cooldownUntil = now + RATE_LIMIT_COOLDOWN_MS;
}

/** True while Klyp is pausing YouTube requests. Other sites are never held back. */
export function youtubeCooldownActive(args: readonly string[], now = Date.now()): boolean {
  return isYoutubeRequest(args) && now < cooldownUntil;
}

export function endYoutubeCooldown(): void {
  cooldownUntil = 0;
}
