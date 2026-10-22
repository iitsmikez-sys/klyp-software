/** Clips are user-insertable rows; never let the background worker fetch arbitrary URLs. */
export function isArchivableSource(value: string): boolean {
  if (/^upload:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return true;
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  if (["youtube.com", "www.youtube.com"].includes(host)) {
    return url.pathname === "/watch" && /^[A-Za-z0-9_-]{11}$/.test(url.searchParams.get("v") ?? "");
  }
  if (["youtu.be", "www.youtu.be"].includes(host)) {
    return /^\/[A-Za-z0-9_-]{11}\/?$/.test(url.pathname);
  }
  if (["twitch.tv", "www.twitch.tv", "m.twitch.tv"].includes(host)) {
    return /^\/videos\/\d+\/?$/.test(url.pathname);
  }
  return false;
}
