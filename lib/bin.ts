import { spawn, type ChildProcess } from "child_process";
import { existsSync } from "fs";
import path from "path";

export type RunOptions = {
  /** Kill the process if it emits no stdout/stderr for this long (stalled). */
  stallTimeoutMs?: number;
  /** Kill the process if it runs longer than this in total. */
  maxRunMs?: number;
};

/** Kill a process and (on Windows) its whole tree — yt-dlp spawns ffmpeg children. */
function killTree(proc: ChildProcess) {
  if (process.platform === "win32" && proc.pid) {
    spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { windowsHide: true });
  } else {
    proc.kill("SIGKILL");
  }
}

/**
 * Detects a disk-full failure from process stderr. Both yt-dlp and ffmpeg
 * write with no free-space check up front, so a full disk otherwise surfaces
 * as an opaque "exited with code 1" — this turns it into an actionable error.
 */
function isDiskSpaceError(text: string): boolean {
  return /no space left on device|not enough space|disk full|enospc|free disk space/i.test(text);
}

/** True if a thrown error is a disk-full failure — lets callers free space and retry. */
export function isDiskFullError(err: unknown): boolean {
  return isDiskSpaceError(err instanceof Error ? err.message : String(err));
}
const DISK_SPACE_ERROR_MESSAGE =
  "ran out of disk space (no space left on device). Free up space in the video cache and try again.";

/**
 * Resolve an external binary (yt-dlp, ffmpeg, ffprobe) robustly:
 *   1. Env var override (YTDLP_PATH / FFMPEG_PATH / FFPROBE_PATH)
 *   2. The winget shim directory — covers dev servers started with a stale PATH
 *   3. ffprobe only: sibling of the resolved ffmpeg (they ship together)
 *   4. Plain binary name, relying on PATH
 */
export function resolveBin(name: "yt-dlp" | "ffmpeg" | "ffprobe"): string {
  const envVar = { "yt-dlp": "YTDLP_PATH", ffmpeg: "FFMPEG_PATH", ffprobe: "FFPROBE_PATH" }[name];
  const envOverride = process.env[envVar];
  if (envOverride && existsSync(envOverride)) return envOverride;

  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    const shim = path.join(
      process.env.LOCALAPPDATA,
      "Microsoft", "WinGet", "Links", `${name}.exe`
    );
    if (existsSync(shim)) return shim;
  }

  if (name === "ffprobe") {
    const ffmpeg = resolveBin("ffmpeg");
    if (ffmpeg !== "ffmpeg") {
      const sibling = path.join(path.dirname(ffmpeg), process.platform === "win32" ? "ffprobe.exe" : "ffprobe");
      if (existsSync(sibling)) return sibling;
    }
  }
  return name;
}

/** Like run(), but resolves with the process's stdout. Supports the same timeouts. */
export function runCapture(bin: string, args: string[], opts: RunOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    let killReason: string | null = null;

    let stallTimer: NodeJS.Timeout | undefined;
    const resetStall = () => {
      if (!opts.stallTimeoutMs) return;
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        killReason = `stalled — no output for ${Math.round(opts.stallTimeoutMs! / 1000)}s`;
        killTree(proc);
      }, opts.stallTimeoutMs);
    };
    resetStall();
    const maxTimer = opts.maxRunMs
      ? setTimeout(() => {
          killReason = `timed out after ${Math.round(opts.maxRunMs! / 1000)}s`;
          killTree(proc);
        }, opts.maxRunMs)
      : undefined;

    proc.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
      resetStall();
    });
    proc.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
      resetStall();
    });
    proc.on("error", (err: Error) => {
      clearTimeout(stallTimer);
      clearTimeout(maxTimer);
      reject(
        err.message.includes("ENOENT")
          ? new Error(`${path.basename(bin)} is not installed or not on PATH.`)
          : err
      );
    });
    proc.on("close", (code: number | null) => {
      clearTimeout(stallTimer);
      clearTimeout(maxTimer);
      if (killReason) {
        reject(new Error(`${path.basename(bin)} ${killReason}. stderr: ${stderr.slice(-300)}`));
      } else if (code === 0) {
        resolve(stdout);
      } else {
        const tail = stderr.slice(-500);
        reject(
          isDiskSpaceError(tail)
            ? new Error(`${path.basename(bin)} ${DISK_SPACE_ERROR_MESSAGE}`)
            : new Error(`${path.basename(bin)} exited with code ${code}: ${tail}`)
        );
      }
    });
  });
}

/** Spawn a process and resolve on exit 0, reject with stderr tail otherwise. */
export function run(bin: string, args: string[], opts: RunOptions = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { windowsHide: true });
    let stderr = "";
    let killReason: string | null = null;

    let stallTimer: NodeJS.Timeout | undefined;
    const resetStall = () => {
      if (!opts.stallTimeoutMs) return;
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        killReason = `stalled — no output for ${Math.round(opts.stallTimeoutMs! / 1000)}s`;
        killTree(proc);
      }, opts.stallTimeoutMs);
    };
    resetStall();
    const maxTimer = opts.maxRunMs
      ? setTimeout(() => {
          killReason = `timed out after ${Math.round(opts.maxRunMs! / 1000)}s`;
          killTree(proc);
        }, opts.maxRunMs)
      : undefined;

    proc.stdout.on("data", resetStall);
    proc.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
      resetStall();
    });
    proc.on("error", (err: Error) => {
      clearTimeout(stallTimer);
      clearTimeout(maxTimer);
      reject(
        err.message.includes("ENOENT")
          ? new Error(`${path.basename(bin)} is not installed or not on PATH.`)
          : err
      );
    });
    proc.on("close", (code: number | null) => {
      clearTimeout(stallTimer);
      clearTimeout(maxTimer);
      if (killReason) {
        reject(new Error(`${path.basename(bin)} ${killReason}. stderr: ${stderr.slice(-300)}`));
      } else if (code === 0) {
        resolve();
      } else {
        const tail = stderr.slice(-500);
        reject(
          isDiskSpaceError(tail)
            ? new Error(`${path.basename(bin)} ${DISK_SPACE_ERROR_MESSAGE}`)
            : new Error(`${path.basename(bin)} exited with code ${code}: ${tail}`)
        );
      }
    });
  });
}

/** Failure signatures from yt-dlp that are almost always transient throttling, not a real block. */
const TRANSIENT_YTDLP_ERROR = /HTTP Error 403|HTTP Error 429|Read timed out|Connection reset|Temporary failure|stalled — no output/i;

/**
 * Like run(), but retries once on yt-dlp's transient throttling errors (YouTube's
 * bot-detection intermittently 403s a fresh request that succeeds moments later).
 * A stalled download (killed by stallTimeoutMs) counts as transient too.
 * Non-transient failures (bad URL, missing binary, private/deleted video) fail fast.
 */
export async function runYtDlpWithRetry(
  args: string[],
  opts: RunOptions = {},
  retries = 1,
  delayMs = 3000
): Promise<void> {
  const bin = resolveBin("yt-dlp");
  for (let attempt = 0; ; attempt++) {
    try {
      await run(bin, args, opts);
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Check disk-full FIRST. A download that wedges because the drive is
      // full gets killed by stallTimeoutMs, which looks "transient" — and
      // was then reported as "YouTube is rate-limiting downloads", sending
      // people chasing a throttling problem they don't have.
      if (isDiskSpaceError(message)) throw err;
      const transient = TRANSIENT_YTDLP_ERROR.test(message);
      if (!transient || attempt >= retries) {
        throw transient
          ? new Error("YouTube is rate-limiting downloads right now — please wait a moment and try again.")
          : err;
      }
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}
