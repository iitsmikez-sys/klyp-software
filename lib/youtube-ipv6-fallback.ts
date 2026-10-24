/** Retry YouTube's bot challenge from the alternate outbound address family. */
export function shouldRetryYouTubeOverIpv6(args: string[], message: string): boolean {
  return !args.includes("--force-ipv6")
    && args.some((arg) => /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\//i.test(arg))
    && /sign in to confirm you(?:['’]re| are) not a bot/i.test(message);
}

