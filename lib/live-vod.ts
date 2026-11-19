/**
 * A Twitch VOD of a stream that is still going (or ended a moment ago) can only be downloaded as fast as it plays, so
 * Analyze would wait for minutes and then fail. These helpers spot that from Twitch's own numbers (when the VOD began and
 * how long it is so far) before any download starts, and decide what to tell the person.
 */

/** A VOD whose end is this close to now is treated as live (Twitch updates the length every few seconds, and a just-ended stream is still being finished). */
export const LIVE_GRACE_SECONDS = 180;

/** What the panel shows: sell auto-clipping, say it will happen by itself, ask to connect Twitch, or just say to come back. */
export type LiveMode = "upsell" | "auto" | "connect" | "wait";

/** True when the VOD began at `createdAt` and has run `durationSeconds` so far, and that runs up to (about) now. */
export function isStillLive(createdAt: string, durationSeconds: number, now: number = Date.now()): boolean {
  const began = Date.parse(createdAt);
  if (!Number.isFinite(began) || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return false;
  const endsAt = began + durationSeconds * 1000;
  return now - endsAt <= LIVE_GRACE_SECONDS * 1000;
}

/**
 * What to tell this person about a live stream.
 * - Free: auto-clipping is the Pro answer to "I want clips when the stream ends".
 * - Pro with auto-clipping on for the channel that is live: it will happen by itself.
 * - Pro with no Twitch channel connected at all: connecting turns it on.
 * - Anyone else (Pro looking at another channel, or auto-clipping off for this one): come back when it ends.
 */
export function liveModeFor(args: {
  isPro: boolean;
  channels: { twitch_user_id: string | null; auto_clip_enabled: boolean }[];
  streamUserId: string | null | undefined;
}): LiveMode {
  if (!args.isPro) return "upsell";
  const connected = args.channels.filter((c) => !!c.twitch_user_id);
  if (args.streamUserId && connected.some((c) => c.twitch_user_id === args.streamUserId && c.auto_clip_enabled)) return "auto";
  if (connected.length === 0) return "connect";
  return "wait";
}
