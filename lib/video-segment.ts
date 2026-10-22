import { execFile } from "child_process";
import { existsSync } from "fs";
import { stat, unlink } from "fs/promises";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/** yt-dlp can exit successfully with an audio-only MP4; size alone is insufficient. */
export async function hasVideoStream(filePath: string, ffprobePath: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(ffprobePath, [
      "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=index",
      "-of", "csv=p=0", filePath,
    ], { timeout: 15_000, maxBuffer: 1024 });
    return stdout.trim().length > 0;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") throw err;
    return false;
  }
}

/** Replace an invalid cache entry, then retry once with a video-first format. */
export async function ensureVideoSegment(
  filePath: string,
  downloadPrimary: () => Promise<void>,
  downloadFallback: () => Promise<void>,
  probe: (filePath: string) => Promise<boolean>
): Promise<void> {
  const usable = async () =>
    existsSync(filePath) && (await stat(filePath)).size > 0 && await probe(filePath);

  if (await usable()) return;
  await unlink(filePath).catch(() => {});

  await downloadPrimary();
  if (await usable()) return;
  await unlink(filePath).catch(() => {});

  await downloadFallback();
  if (await usable()) return;
  await unlink(filePath).catch(() => {});
  throw new Error("Downloaded segment contains no video stream.");
}
