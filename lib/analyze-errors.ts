import { isAnthropicCreditBalanceError } from "./anthropic-credit.ts";
import { LIVE_DOWNLOAD_REASON } from "./live-download.ts";

/** A download that crawls at about the speed the video plays is a stream that is still live: it cannot be fetched faster than it is being made. */
export const LIVE_VOD_MESSAGE = "This video is downloading only as fast as it plays, which usually means the stream is still live (or only just ended). Wait until the stream has fully ended, then try again. No Sparks were charged.";
export const DOWNLOAD_TIMEOUT_MESSAGE = "Downloading this video took too long. Try again in a few minutes, or try a shorter video. No Sparks were charged.";

/** "yt-dlp timed out after 600s. stderr: ... speed=1.04x ..." becomes a plain sentence. Returns null for any other message. */
export function timedOutDownloadMessage(message: string): string | null {
  // Stopped on purpose after about a minute because the download crawled at the video's playing speed (lib/live-download.ts).
  if (message.includes(LIVE_DOWNLOAD_REASON)) return LIVE_VOD_MESSAGE;
  if (!/yt-dlp timed out after \d+s/i.test(message)) return null;
  const speeds = [...message.matchAll(/speed=\s*([0-9]+(?:\.[0-9]+)?)x/gi)].map((m) => Number(m[1]));
  // Live: every reading is within a whisker of 1x (0.8x to 1.5x). Much slower is a bad connection, much faster is just a huge file.
  return speeds.length > 0 && speeds.every((s) => s >= 0.8 && s <= 1.5) ? LIVE_VOD_MESSAGE : DOWNLOAD_TIMEOUT_MESSAGE;
}
/** Keep provider diagnostics in server logs while giving users an actionable error. */
export function userFacingAnalysisError(stage: string, url: string, message: string): string {
  if (isAnthropicCreditBalanceError(message)) return "Klyp AI clip analysis is temporarily unavailable because its provider credit balance is empty. No Sparks were charged. Please try again later.";
  const youtubeUrl = /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)/i.test(url);
  const botChallenge = /sign in to confirm you(?:['’]re| are) not a bot/i.test(message);
  if (stage === "download" && youtubeUrl && botChallenge) {
    return "YouTube blocked the server from downloading this VOD. Try a Twitch VOD or upload your own video file instead. No Sparks were charged.";
  }
  if (stage === "download") {
    const timedOut = timedOutDownloadMessage(message);
    if (timedOut) return timedOut;
  }
  return message;
}

/** The SSE client appends a stage suffix, so match the stable user-facing prefix. */
export function isYouTubeBotBlockError(message: string | null): boolean {
  return message?.startsWith("YouTube blocked the server from downloading this VOD.") ?? false;
}

/** A clip download that fails because of the video site: plain words instead of raw yt-dlp output. */
export function userFacingClipError(message: string): string {
  if (/sign in to confirm you(?:['’]re| are) not a bot/i.test(message)) {
    return "YouTube is blocking this video right now. Try again in a few minutes, or use a Twitch or Kick link.";
  }
  // Safari on iPhone says exactly "Load failed" when the connection drops, for example when the phone sleeps mid-download.
  if (/^(load failed|failed to fetch|networkerror|the network connection was lost)/i.test(message.trim())) {
    return "The connection dropped. Keep this screen open and try again.";
  }
  const timedOut = timedOutDownloadMessage(message);
  if (timedOut) return timedOut;
  if (/^yt-dlp exited with code/i.test(message)) {
    return "This video couldn't be downloaded right now. Try again in a few minutes.";
  }
  return message;
}
