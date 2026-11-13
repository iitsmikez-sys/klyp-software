/** Stable identity for a VOD regardless of URL tracking parameters. */
export function vodSourceKey(url: string, uploadId?: string): string | null {
  if (uploadId) return /^[-\w]{1,100}$/.test(uploadId) ? `upload:${uploadId}` : null;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "youtu.be") {
    const id = parsed.pathname.split("/")[1];
    return /^[A-Za-z0-9_-]{11}$/.test(id ?? "") ? `youtube:${id}` : null;
  }
  if (host === "youtube.com") {
    const id = parsed.searchParams.get("v");
    return parsed.pathname === "/watch" && /^[A-Za-z0-9_-]{11}$/.test(id ?? "") ? `youtube:${id}` : null;
  }
  if (host === "twitch.tv" || host === "m.twitch.tv") {
    const match = /^\/videos\/(\d+)\/?$/.exec(parsed.pathname);
    return match ? `twitch:${match[1]}` : null;
  }
  if (host === "kick.com") {
    // kick.com/<channel>/videos/<uuid> and the newer kick.com/video/<uuid>
    const match = /^\/(?:video|[\w.-]+\/videos)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i.exec(parsed.pathname);
    return match ? `kick:${match[1].toLowerCase()}` : null;
  }
  return null;
}

/**
 * The reverse of vodSourceKey: a link that works for the clip routes, rebuilt from the saved identity of a VOD. An analysis stores
 * only this key (not the link the person pasted), so anything that has to hand a link back (the "last analysis" banner) rebuilds it here.
 */
export function sourceKeyToUrl(key: string | null | undefined): string {
  const match = /^(youtube|twitch|kick|upload):(.+)$/.exec(key ?? "");
  if (!match) return "";
  const [, kind, id] = match;
  if (kind === "upload") return /^[-\w]{1,100}$/.test(id) ? `upload:${id}` : "";
  if (kind === "twitch") return /^\d+$/.test(id) ? `https://www.twitch.tv/videos/${id}` : "";
  if (kind === "kick") return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? `https://kick.com/video/${id}` : "";
  return /^[A-Za-z0-9_-]{11}$/.test(id) ? `https://www.youtube.com/watch?v=${id}` : "";
}
