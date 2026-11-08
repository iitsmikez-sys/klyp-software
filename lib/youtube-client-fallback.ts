/**
 * Other ways of asking YouTube. When YouTube answers a cloud server with "Sign in to confirm you're not a bot", yt-dlp can
 * pretend to be a different kind of YouTube app (a TV, an Android VR headset, mobile Safari...). Some of those are not
 * asked to prove they are human. This only runs AFTER a request was blocked, so it cannot make a working download worse,
 * and it logs which one worked so we learn what YouTube lets through. Pure, apart from the log line.
 */

/**
 * The player types to try, in order. Chosen by testing yt-dlp 2026.08.19 against a public video from an unblocked
 * computer: android_vr, tv_simply, tv_embedded, web_embedded and mweb all returned the video, while tv, web_safari,
 * web_creator, web_music and ios failed even there, so they are left out. That shows the names are valid and give
 * formats; whether YouTube lets them past the bot check on a cloud server is what the log lines will tell us.
 */
export const YOUTUBE_FALLBACK_CLIENTS = ["android_vr", "tv_simply", "tv_embedded", "web_embedded", "mweb"] as const;

const YOUTUBE_URL = /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\//i;
const BOT_CHALLENGE = /sign in to confirm you(?:['’]re| are) not a bot/i;
const CLIENT_ARG = "youtube:player_client=";

/** True when this yt-dlp call was for a YouTube link and YouTube answered with its bot check. */
export function isYouTubeBotChallenge(args: readonly string[], message: string): boolean {
  return args.some((arg) => YOUTUBE_URL.test(arg)) && BOT_CHALLENGE.test(message);
}

/** The same arguments, asking as the given kind of YouTube app. Left alone if a client was already chosen. */
export function withYoutubeClient(args: readonly string[], client: string): string[] {
  if (args.some((arg) => arg.startsWith(CLIENT_ARG))) return [...args];
  return ["--extractor-args", `${CLIENT_ARG}${client}`, ...args];
}

export type FallbackResult<T> = { ok: true; value: T; client: string } | { ok: false };

/**
 * After a blocked request, try each player type in turn with `attempt` and stop at the first that works. Does nothing
 * (returns { ok: false } without calling `attempt`) unless the failure really was YouTube's bot check.
 */
export async function tryYoutubeClients<T>(
  args: readonly string[],
  message: string,
  attempt: (args: string[]) => Promise<T>,
  options: { clients?: readonly string[]; log?: (line: string) => void } = {},
): Promise<FallbackResult<T>> {
  const log = options.log ?? ((line: string) => console.log(line));
  if (!isYouTubeBotChallenge(args, message)) return { ok: false };
  for (const client of options.clients ?? YOUTUBE_FALLBACK_CLIENTS) {
    try {
      const value = await attempt(withYoutubeClient(args, client));
      log(`[yt-dlp] YouTube's bot check was passed by asking as player client "${client}"`);
      return { ok: true, value, client };
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      log(`[yt-dlp] player client "${client}" did not get through: ${text.replace(/\s+/g, " ").slice(-160)}`);
    }
  }
  log("[yt-dlp] YouTube's bot check: every other player client failed too");
  return { ok: false };
}
