import { isAnthropicCreditBalanceError } from "./anthropic-credit.ts";
/** Keep provider diagnostics in server logs while giving users an actionable error. */
export function userFacingAnalysisError(stage: string, url: string, message: string): string {
  if (isAnthropicCreditBalanceError(message)) return "Klyp AI clip analysis is temporarily unavailable because its provider credit balance is empty. No Sparks were charged. Please try again later.";
  const youtubeUrl = /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)/i.test(url);
  const botChallenge = /sign in to confirm you(?:['’]re| are) not a bot/i.test(message);
  if (stage === "download" && youtubeUrl && botChallenge) {
    return "YouTube blocked the server from downloading this VOD. Try a Twitch VOD or upload your own video file instead. No Sparks were charged.";
  }
  return message;
}

/** The SSE client appends a stage suffix, so match the stable user-facing prefix. */
export function isYouTubeBotBlockError(message: string | null): boolean {
  return message?.startsWith("YouTube blocked the server from downloading this VOD.") ?? false;
}
