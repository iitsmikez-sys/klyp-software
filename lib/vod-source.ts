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
