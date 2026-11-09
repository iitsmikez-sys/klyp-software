/**
 * YouTube publishes tiny preview pictures ("storyboards") for every video: sheets of small frames, one frame every few seconds,
 * a few hundred KB for the whole video. yt-dlp saves them as one .mhtml file (a plain multipart text file with the images inside).
 * A clip card's still picture can come from there in seconds, instead of downloading video. Pure helpers, no imports, so they can be
 * tested on their own.
 */

export type StoryboardMeta = {
  tileWidth: number;
  tileHeight: number;
  rows: number;
  columns: number;
  /** Frames per second of video (about 0.1: one frame every 10 seconds). */
  fps: number;
  sheetCount: number;
};

/** The sheets inside a yt-dlp .mhtml file, in order, as raw image bytes. */
export function parseMhtmlImages(file: Uint8Array): Uint8Array[] {
  const buf = Buffer.from(file.buffer, file.byteOffset, file.byteLength);
  const head = buf.subarray(0, Math.min(buf.length, 2000)).toString("latin1");
  const boundary = /boundary="?([^";\r\n]+)"?/i.exec(head)?.[1];
  if (!boundary) return [];
  const marker = Buffer.from(`--${boundary}`, "latin1");
  const images: Uint8Array[] = [];
  let pos = buf.indexOf(marker);
  while (pos !== -1) {
    const afterMarker = pos + marker.length;
    if (buf.subarray(afterMarker, afterMarker + 2).toString("latin1") === "--") break; // closing boundary
    // Part headers end at the first blank line (LF or CRLF).
    const headersEnd = (() => {
      const lf = buf.indexOf("\n\n", afterMarker, "latin1");
      const crlf = buf.indexOf("\r\n\r\n", afterMarker, "latin1");
      if (lf === -1 && crlf === -1) return null;
      if (crlf !== -1 && (lf === -1 || crlf < lf)) return { at: crlf, len: 4 };
      return { at: lf, len: 2 };
    })();
    if (!headersEnd) break;
    const headers = buf.subarray(afterMarker, headersEnd.at).toString("latin1");
    const bodyStart = headersEnd.at + headersEnd.len;
    const length = Number(/content-length:\s*(\d+)/i.exec(headers)?.[1]);
    const isImage = /content-type:\s*image\//i.test(headers);
    if (Number.isFinite(length) && length >= 0) {
      if (isImage) images.push(buf.subarray(bodyStart, bodyStart + length));
      pos = buf.indexOf(marker, bodyStart + length);
    } else {
      pos = buf.indexOf(marker, bodyStart); // no length: skip to the next part
    }
  }
  return images;
}

/** Which sheet, and which tile on it, shows the video at `seconds`, plus where that tile sits on the sheet in pixels. */
export function storyboardTile(meta: StoryboardMeta, seconds: number): { sheet: number; row: number; column: number; x: number; y: number } {
  const perSheet = meta.rows * meta.columns;
  const lastTile = meta.sheetCount * perSheet - 1;
  const index = Math.min(lastTile, Math.max(0, Math.floor(Math.max(0, seconds) * meta.fps)));
  const sheet = Math.floor(index / perSheet);
  const within = index % perSheet;
  const row = Math.floor(within / meta.columns);
  const column = within % meta.columns;
  return { sheet, row, column, x: column * meta.tileWidth, y: row * meta.tileHeight };
}

/** Pull the storyboard's layout out of yt-dlp's info JSON (what it saved next to the .mhtml). */
export function storyboardMetaFromInfo(info: unknown, sheetCount: number): StoryboardMeta | null {
  const root = info as { requested_formats?: unknown[]; formats?: unknown[]; format_id?: string } | null;
  if (!root) return null;
  const chosen = (root.requested_formats?.[0] ?? root.formats?.find((f) => (f as { format_id?: string }).format_id === root.format_id)) as
    { width?: number; height?: number; rows?: number; columns?: number; fps?: number } | undefined;
  if (!chosen) return null;
  const { width, height, rows, columns, fps } = chosen;
  if (![width, height, rows, columns, fps].every((v) => typeof v === "number" && Number.isFinite(v) && v > 0)) return null;
  if (!Number.isInteger(sheetCount) || sheetCount < 1) return null;
  return { tileWidth: width!, tileHeight: height!, rows: rows!, columns: columns!, fps: fps!, sheetCount };
}
