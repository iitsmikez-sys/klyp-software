export type VodProbe = { durationSeconds: number; title: string | null; thumbnail: string | null; /** False when the source offers only sound (for example a subscriber-only Twitch VOD): moments can be found but no video clip can be cut. */ videoAvailable: boolean };

export const AUDIO_ONLY_MESSAGE =
  "This video only offers its sound to Klyp (a Twitch video can be subscriber-only or restricted), so Klyp can't cut clips from it. Try another video, or upload the file.";

/** True unless the downloader says the best choice has no picture ("none" / "audio only"). Anything unclear counts as available. */
export function hasVideoStream(vcodec: unknown): boolean {
  return !(typeof vcodec === "string" && /^(none|audio only)$/i.test(vcodec.trim()));
}

export function parseVodProbe(raw: string): VodProbe {
  // The metadata command prints only these three JSON-encoded fields. Full
  // yt-dlp JSON can exceed runCapture's 16 KB output cap on long VODs.
  const lines = raw.trim().split(/\r?\n/);
  const read = (index: number): unknown => {
    try { return JSON.parse(lines[index]); } catch { return null; }
  };
  const durationSeconds = Math.round(Number(read(0)));
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("No duration in metadata (is this a live stream?).");
  }
  const rawTitle = read(1);
  const title = typeof rawTitle === "string" && rawTitle !== "NA" ? rawTitle.trim().slice(0, 180) : "";
  let thumbnail: string | null = null;
  const rawThumbnail = read(2);
  if (typeof rawThumbnail === "string") {
    try {
      const parsed = new URL(rawThumbnail);
      if (parsed.protocol === "https:") thumbnail = parsed.toString();
    } catch { /* No usable thumbnail. */ }
  }
  return { durationSeconds, title: title || null, thumbnail, videoAvailable: hasVideoStream(read(3)) };
}
