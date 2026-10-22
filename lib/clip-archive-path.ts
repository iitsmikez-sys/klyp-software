/** Storage paths are server-generated when a clip is archived. A user can
 * insert a clips row through RLS, so never trust a path copied from that row
 * to authorize a private-bucket read. */
export function ownClipArchivePath(
  storedPath: string | null,
  userId: string,
  clipId: string,
  object: "master" | "proxy" | "poster"
): string | null {
  const extension = object === "poster" ? "jpg" : "mp4";
  const expected = `${userId}/${clipId}/${object}.${extension}`;
  return storedPath === expected ? expected : null;
}
