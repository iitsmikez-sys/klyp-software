/**
 * YouTube links are switched off: YouTube blocks the processing service's server address, so clips from YouTube
 * links cannot be downloaded. Set NEXT_PUBLIC_YOUTUBE_ENABLED=1 (on the website AND the processing service, then redeploy
 * both) to turn it back on, for example once a proxy is in place. No imports on purpose: the pages, the paste box and the
 * server routes all read it.
 */
export const YOUTUBE_ENABLED = process.env.NEXT_PUBLIC_YOUTUBE_ENABLED === "1";

export const YOUTUBE_LINK = /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\//i;

export const YOUTUBE_OFF_MESSAGE = "YouTube links aren't supported right now. Paste a Twitch or Kick VOD link instead. No Sparks are charged.";

/** The sites Klyp reads VOD links from, for the page copy. */
export const VOD_SITES = YOUTUBE_ENABLED ? "YouTube, Twitch and Kick" : "Twitch and Kick";
/** The same, as "A or B" for sentences like "Paste a ... link". */
export const VOD_SITES_OR = YOUTUBE_ENABLED ? "YouTube, Twitch, or Kick" : "Twitch or Kick";
