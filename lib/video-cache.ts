/**
 * Source-video cache shared between /api/clip and /api/preview.
 * Downloads the full VOD once per URL and reuses it for all clips.
 * Module-level Map dedupes concurrent requests for the same VOD.
 */
import { createHash } from "crypto";
import { mkdir, readdir, stat } from "fs/promises";
import { existsSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { resolveBin, runYtDlpWithRetry } from "@/lib/bin";

export const CACHE_DIR = path.join(tmpdir(), "klyp-videos");

/* ── Uploaded VOD files ─────────────────────────────────────────────
 * Uploads are stored as upload-<uuid>.<ext> in CACHE_DIR and referenced
 * everywhere a VOD URL is expected as "upload:<uuid>". */

export const UPLOAD_PREFIX = "upload:";
const UPLOAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUploadRef(url: string): boolean {
  return url.startsWith(UPLOAD_PREFIX);
}

/** Find the stored file for an upload id — null if missing/expired. */
export async function findUploadedVideo(uploadId: string): Promise<string | null> {
  if (!UPLOAD_ID_PATTERN.test(uploadId)) return null;
  try {
    const files = await readdir(CACHE_DIR);
    const match = files.find((f) => f.startsWith(`upload-${uploadId}.`));
    return match ? path.join(CACHE_DIR, match) : null;
  } catch {
    return null;
  }
}

/**
 * Resolve a VOD reference (https URL or "upload:<id>") to a local file path,
 * downloading the URL if it isn't cached yet.
 */
export async function resolveSource(ref: string): Promise<string> {
  if (isUploadRef(ref)) {
    const p = await findUploadedVideo(ref.slice(UPLOAD_PREFIX.length));
    if (!p) throw new Error("Uploaded file is no longer available — upload your VOD again.");
    return p;
  }
  return ensureSourceVideo(ref);
}

const inflightDownloads = new Map<string, Promise<string>>();

export async function ensureSourceVideo(url: string): Promise<string> {
  const key = createHash("sha1").update(url).digest("hex");
  const outPath = path.join(CACHE_DIR, `${key}.mp4`);

  if (existsSync(outPath) && (await stat(outPath)).size > 0) return outPath;

  const existing = inflightDownloads.get(key);
  if (existing) return existing;

  const download = (async () => {
    await mkdir(CACHE_DIR, { recursive: true });
    await runYtDlpWithRetry([
      "-f", "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*[height<=1080]+ba/b",
      "--merge-output-format", "mp4",
      "--no-playlist",
      "--ffmpeg-location", resolveBin("ffmpeg"),
      "-o", outPath,
      url,
    ]);
    if (!existsSync(outPath)) {
      throw new Error("yt-dlp finished but the merged MP4 was not produced.");
    }
    return outPath;
  })();

  inflightDownloads.set(key, download);
  try {
    return await download;
  } finally {
    inflightDownloads.delete(key);
  }
}
