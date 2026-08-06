/**
 * Source-video cache shared between /api/clip and /api/preview.
 * Downloads the full VOD once per URL and reuses it for all clips.
 * Module-level Map dedupes concurrent requests for the same VOD.
 */
import { createHash } from "crypto";
import { mkdir, readdir, stat, statfs, unlink } from "fs/promises";
import { existsSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { ffmpegLocationArgs, isDiskFullError, runYtDlpWithRetry } from "@/lib/bin";

export const CACHE_DIR = path.join(tmpdir(), "klyp-videos");

const GB = 1024 * 1024 * 1024;

/** Read a GB-valued env override, falling back to a default. */
function envGb(name: string, fallbackGb: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw * GB : fallbackGb * GB;
}

/**
 * Total cache size cap. Once exceeded, the oldest completed VOD downloads
 * (LRU by mtime) are evicted before a new download starts. Never touches
 * uploads or the file currently being downloaded. Without this the cache
 * grows forever — it's what silently ran the disk down to single-digit GB
 * free and caused preview/export to fail unpredictably at whichever step
 * happened to run out of space first.
 */
const CACHE_MAX_BYTES = envGb("KLYP_CACHE_MAX_GB", 20);

/**
 * Free space to keep available on the cache's volume at all times.
 *
 * The size cap alone is NOT enough, and this is the bug that made "ran out
 * of disk space" keep coming back: the cap only bounds what *we* store, so
 * on a drive that's already low on space the cache can sit happily under
 * the cap while the volume itself has nothing left — and yt-dlp/ffmpeg,
 * which never check free space up front, die mid-write with ENOSPC. We now
 * evict against real free space too, so a full VOD download can't wedge the
 * disk regardless of how big the cache happens to be.
 */
const MIN_FREE_BYTES = envGb("KLYP_CACHE_MIN_FREE_GB", 15);

const log = (...args: unknown[]) => console.log("[video-cache]", new Date().toISOString(), ...args);

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

/**
 * Delete leftover partial/temp artifacts for a download key — yt-dlp's
 * `.part`, `.part-FragN.part`, `.ytdl`, and ffmpeg's `.temp.mp4` merge
 * remnant. Runs before a fresh attempt and after a failed one, so a killed
 * or interrupted download (stall/timeout kill, process crash, dev-server
 * restart) doesn't leak disk space forever. Best-effort — a file still open
 * elsewhere just gets skipped and retried next time. Never touches the
 * completed `${key}.mp4` itself.
 */
async function pruneStaleArtifacts(key: string): Promise<void> {
  let files: string[];
  try {
    files = await readdir(CACHE_DIR);
  } catch {
    return;
  }
  const stale = files.filter((f) => f.startsWith(`${key}.`) && f !== `${key}.mp4`);
  for (const f of stale) {
    try {
      await unlink(path.join(CACHE_DIR, f));
      log("pruned stale artifact", f);
    } catch {
      // in use or already gone — fine, next prune will catch it
    }
  }
}

/** List a key's partial download artifacts (.part/.ytdl/fragments) — empty if none. */
async function partialArtifacts(key: string): Promise<string[]> {
  try {
    const files = await readdir(CACHE_DIR);
    return files.filter((f) => f.startsWith(`${key}.`) && f !== `${key}.mp4`);
  } catch {
    return [];
  }
}

/**
 * True if another download for this key is actively in progress right now,
 * detected by its temp files' combined size growing over a short sample
 * window — not just by their presence (which could be dead debris from a
 * killed/crashed attempt).
 *
 * This exists because `inflightDownloads` (below) is an in-memory Map and
 * ONLY dedupes calls within the same module instance. In Next.js dev mode
 * each API route is compiled as a separate bundle, so /api/preview and
 * /api/clip each get their OWN copy of this module — a download started by
 * one is invisible to the other's in-memory Map. Without this check, a
 * preview followed shortly by an export of the same VOD would start a
 * second, colliding yt-dlp process writing the same fragment files, which
 * fails with a Windows file-in-use error (confirmed live: this is exactly
 * what was happening). Checking the filesystem instead of memory catches
 * this regardless of which module instance is asking.
 */
async function isActivelyDownloading(key: string): Promise<boolean> {
  const files = await partialArtifacts(key);
  if (files.length === 0) return false;

  const totalSize = async () => {
    let sum = 0;
    for (const f of files) {
      try {
        sum += (await stat(path.join(CACHE_DIR, f))).size;
      } catch {
        // vanished between readdir and stat — fine, just don't count it
      }
    }
    return sum;
  };

  const before = await totalSize();
  await new Promise((r) => setTimeout(r, 1500));
  const after = await totalSize();
  return after > before;
}

/**
 * Wait for another process/module instance's in-progress download of this
 * key to finish, instead of starting a second one that would collide with
 * it. Polls for the final file; bails out if the other download's own
 * artifacts disappear without producing it (it failed) or after a timeout.
 */
async function waitForConcurrentDownload(outPath: string, key: string): Promise<string> {
  const POLL_MS = 2000;
  const MAX_WAIT_MS = 30 * 60_000; // matches ensureSourceVideo's own maxRunMs
  const startedAt = Date.now();

  while (Date.now() - startedAt < MAX_WAIT_MS) {
    if (existsSync(outPath) && (await stat(outPath)).size > 0) {
      log("joined a concurrent download already in progress", key);
      return outPath;
    }
    if ((await partialArtifacts(key)).length === 0) {
      throw new Error("A concurrent download of this video ended without completing — try again.");
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error("Timed out waiting for a concurrent download of this video to finish.");
}

/** Bytes actually available on the cache's volume — null if unavailable. */
async function freeBytes(): Promise<number | null> {
  try {
    const fs = await statfs(CACHE_DIR);
    return fs.bavail * fs.bsize;
  } catch {
    return null;
  }
}

/**
 * Free cache space before a download, on two independent triggers:
 *
 *   1. the cache is over CACHE_MAX_BYTES (bounds what we hoard), and
 *   2. the volume has less than MIN_FREE_BYTES available (bounds what the
 *      *disk* has left, which is what actually makes yt-dlp die with ENOSPC).
 *
 * Completed VOD downloads are deleted oldest-first (LRU by mtime). Skips
 * uploaded files and the key about to be downloaded. Best-effort: a file
 * that's mid-read by a concurrent preview/export request is left alone.
 *
 * `aggressive` drops every evictable file regardless of the thresholds —
 * used to recover after an actual disk-full failure.
 */
async function ensureCacheSpace(excludeKey: string, aggressive = false): Promise<void> {
  let names: string[];
  try {
    names = await readdir(CACHE_DIR);
  } catch {
    return;
  }

  const candidates: { name: string; size: number; mtimeMs: number }[] = [];
  let total = 0;
  for (const name of names) {
    let s;
    try {
      s = await stat(path.join(CACHE_DIR, name));
    } catch {
      continue;
    }
    total += s.size;
    if (name.endsWith(".mp4") && !name.startsWith("upload-") && !name.startsWith(`${excludeKey}.`)) {
      candidates.push({ name, size: s.size, mtimeMs: s.mtimeMs });
    }
  }

  const free = await freeBytes();
  const overCap = Math.max(0, total - CACHE_MAX_BYTES);
  const shortOnDisk = free === null ? 0 : Math.max(0, MIN_FREE_BYTES - free);
  const toFree = aggressive ? Infinity : Math.max(overCap, shortOnDisk);
  if (toFree <= 0) return;

  candidates.sort((a, b) => a.mtimeMs - b.mtimeMs); // oldest first
  log(
    "freeing cache space",
    `cache ${(total / 1e9).toFixed(1)}GB / ${(CACHE_MAX_BYTES / 1e9).toFixed(0)}GB`,
    free === null ? "(disk free unknown)" : `disk free ${(free / 1e9).toFixed(1)}GB / ${(MIN_FREE_BYTES / 1e9).toFixed(0)}GB floor`,
    aggressive ? "— aggressive" : `— need ${(toFree / 1e9).toFixed(1)}GB`
  );

  let freed = 0;
  for (const c of candidates) {
    if (freed >= toFree) break;
    try {
      await unlink(path.join(CACHE_DIR, c.name));
      freed += c.size;
      log("evicted", c.name, `${(c.size / 1e9).toFixed(1)}GB`);
    } catch {
      // likely open for a concurrent request — skip, try the next oldest
    }
  }

  // Still short after evicting everything we're allowed to touch: the space
  // is being used by something outside the cache, so say so up front rather
  // than letting yt-dlp fail halfway through a long download.
  if (!aggressive && freed < toFree) {
    const nowFree = await freeBytes();
    if (nowFree !== null && nowFree < MIN_FREE_BYTES) {
      throw new Error(
        `Not enough free disk space to download this VOD — ${(nowFree / 1e9).toFixed(1)}GB free, ` +
          `Klyp needs ${(MIN_FREE_BYTES / 1e9).toFixed(0)}GB. Free up space on the drive holding ${CACHE_DIR}, ` +
          `or lower the requirement with KLYP_CACHE_MIN_FREE_GB.`
      );
    }
  }
}

const inflightDownloads = new Map<string, Promise<string>>();

export async function ensureSourceVideo(url: string): Promise<string> {
  const key = createHash("sha1").update(url).digest("hex");
  const outPath = path.join(CACHE_DIR, `${key}.mp4`);

  if (existsSync(outPath) && (await stat(outPath)).size > 0) {
    log("cache hit", key);
    return outPath;
  }

  const existing = inflightDownloads.get(key);
  if (existing) return existing;

  const download = (async () => {
    await mkdir(CACHE_DIR, { recursive: true });

    // Someone else (possibly a different Next.js dev-mode route bundle) is
    // already downloading this exact key — join that instead of racing it.
    if (await isActivelyDownloading(key)) {
      return waitForConcurrentDownload(outPath, key);
    }

    await pruneStaleArtifacts(key);
    // A thrown "not enough free disk space" here is deliberate and must
    // propagate; only genuine eviction faults are swallowed as non-fatal.
    await ensureCacheSpace(key);

    const attempt = async (): Promise<string> => {
      const startedAt = Date.now();
      log("download start", key, url.slice(0, 100));
      await runYtDlpWithRetry(
        [
          "-f", "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*[height<=1080]+ba/b",
          "--merge-output-format", "mp4",
          "--no-playlist",
          "--socket-timeout", "30",
          ...ffmpegLocationArgs(),
          "-o", outPath,
          url,
        ],
        // stallTimeoutMs kills a silent wedge; maxRunMs bounds the total download
        // time so a preview/export request can't run forever on an endless VOD.
        { stallTimeoutMs: 90_000, maxRunMs: 30 * 60_000 }
      );
      if (!existsSync(outPath)) {
        throw new Error("yt-dlp finished but the merged MP4 was not produced.");
      }
      const { size } = await stat(outPath);
      log("download done", key, `${((Date.now() - startedAt) / 1000).toFixed(1)}s`, `${(size / 1e9).toFixed(2)}GB`);
      return outPath;
    };

    try {
      return await attempt();
    } catch (err) {
      log("download FAILED", key, err instanceof Error ? err.message : String(err));
      await pruneStaleArtifacts(key); // don't leave partial debris behind on failure

      // Ran the disk dry mid-download (the VOD was bigger than the headroom
      // we reserved). Drop every other cached VOD and take one more shot
      // instead of handing the user a dead end they can't act on.
      if (isDiskFullError(err)) {
        log("disk full — evicting the whole cache and retrying once", key);
        await ensureCacheSpace(key, true).catch((e) => log("aggressive eviction failed (non-fatal)", e));
        try {
          return await attempt();
        } catch (retryErr) {
          log("download FAILED after cache purge", key, retryErr instanceof Error ? retryErr.message : String(retryErr));
          await pruneStaleArtifacts(key);
          throw retryErr;
        }
      }
      throw err;
    }
  })();

  inflightDownloads.set(key, download);
  try {
    return await download;
  } finally {
    inflightDownloads.delete(key);
  }
}
