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
  return null;
}
