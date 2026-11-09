/**
 * A clip card's still picture for a YouTube video, taken from YouTube's own storyboard (see lib/storyboard-math.ts).
 *
 * The storyboard for the WHOLE video is one small download (about 2 MB for an hour, a few seconds), after which every clip of that
 * video gets its picture from a crop of a sheet, with no video downloaded at all. The old way fetched a slice of video per clip and
 * took minutes. The pictures are small (320x180, one every ~10 seconds), which is plenty for a card.
 */
import { mkdir, readFile, readdir, rm, stat, writeFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { resolveBin, run, runYtDlpWithRetry } from "@/lib/bin";
import { CACHE_DIR } from "@/lib/video-cache";
import { vodSourceKey } from "@/lib/vod-source";
import { parseMhtmlImages, storyboardMetaFromInfo, storyboardTile, type StoryboardMeta } from "@/lib/storyboard-math";

export const isYouTubeRef = (url: string): boolean => vodSourceKey(url)?.startsWith("youtube:") ?? false;

const inflight = new Map<string, Promise<{ dir: string; meta: StoryboardMeta }>>();

/** The cache cleanup in lib/video-cache.ts only evicts .mp4 files, so storyboard folders (about 2 MB a video) are tidied here. */
const STORYBOARD_MAX_AGE_MS = 7 * 24 * 3600_000;
let lastPrune = 0;
async function pruneOldStoryboards(now = Date.now()): Promise<void> {
  if (now - lastPrune < 3600_000) return; // at most hourly
  lastPrune = now;
  try {
    for (const name of await readdir(CACHE_DIR)) {
      if (!name.startsWith("sb-")) continue;
      const dir = path.join(CACHE_DIR, name);
      if (now - (await stat(dir)).mtimeMs > STORYBOARD_MAX_AGE_MS) await rm(dir, { recursive: true, force: true });
    }
  } catch { /* best effort: a tidy-up problem never blocks a picture */ }
}

/** Download (once per video) and unpack the storyboard sheets next to a small meta.json. */
async function ensureStoryboard(url: string): Promise<{ dir: string; meta: StoryboardMeta }> {
  const key = vodSourceKey(url);
  if (!key?.startsWith("youtube:")) throw new Error("not a YouTube video");
  const dir = path.join(CACHE_DIR, `sb-${key.slice("youtube:".length)}`); // the id is only letters, digits, - and _
  const metaPath = path.join(dir, "meta.json");
  if (existsSync(metaPath)) return { dir, meta: JSON.parse(await readFile(metaPath, "utf8")) as StoryboardMeta };

  const pending = inflight.get(key);
  if (pending) return pending;
  const job = (async () => {
    await pruneOldStoryboards();
    await mkdir(dir, { recursive: true });
    try {
      // Best size first; a video without the largest one falls back to a smaller one.
      await runYtDlpWithRetry(
        ["-f", "sb0/sb1/sb2", "--write-info-json", "--no-playlist", "--socket-timeout", "30", "-o", path.join(dir, "sb.%(ext)s"), url],
        { stallTimeoutMs: 60_000, maxRunMs: 2 * 60_000 },
      );
      const sheets = parseMhtmlImages(await readFile(path.join(dir, "sb.mhtml")));
      const meta = storyboardMetaFromInfo(JSON.parse(await readFile(path.join(dir, "sb.info.json"), "utf8")), sheets.length);
      if (!meta || !sheets.length) throw new Error("this video has no usable storyboard");
      for (let i = 0; i < sheets.length; i++) await writeFile(path.join(dir, `s${i}.webp`), sheets[i]);
      await writeFile(metaPath, JSON.stringify(meta)); // written last: its presence means the sheets are all there
      await rm(path.join(dir, "sb.mhtml"), { force: true });
      await rm(path.join(dir, "sb.info.json"), { force: true });
      return { dir, meta };
    } catch (err) {
      await rm(dir, { recursive: true, force: true }).catch(() => {}); // no half-made folders
      throw err;
    }
  })();
  inflight.set(key, job);
  try { return await job; } finally { inflight.delete(key); }
}

/** Write the picture for `seconds` into the video to `outPath` (a 640x360 JPEG, cropped from the storyboard tile). */
export async function youtubeStoryboardFrame(url: string, seconds: number, outPath: string, width = 640, height = 360): Promise<void> {
  const { dir, meta } = await ensureStoryboard(url);
  const tile = storyboardTile(meta, seconds);
  const sheet = path.join(dir, `s${tile.sheet}.webp`);
  if (!existsSync(sheet)) throw new Error("storyboard sheet missing");
  await run(resolveBin("ffmpeg"), [
    "-y", "-i", sheet,
    "-vf", `crop=${meta.tileWidth}:${meta.tileHeight}:${tile.x}:${tile.y},scale=${width}:${height}:flags=lanczos`,
    "-frames:v", "1", "-q:v", "3", outPath,
  ], { stallTimeoutMs: 20_000, maxRunMs: 40_000 });
}
