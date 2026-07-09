import { spawn } from "child_process";
import { existsSync } from "fs";
import path from "path";

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

/** Like run(), but resolves with the process's stdout. */
export function runCapture(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    proc.on("error", (err: Error) =>
      reject(
        err.message.includes("ENOENT")
          ? new Error(`${path.basename(bin)} is not installed or not on PATH.`)
          : err
      )
    );
    proc.on("close", (code: number | null) =>
      code === 0
        ? resolve(stdout)
        : reject(new Error(`${path.basename(bin)} exited with code ${code}: ${stderr.slice(-500)}`))
    );
  });
}

/** Spawn a process and resolve on exit 0, reject with stderr tail otherwise. */
export function run(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { windowsHide: true });
    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    proc.on("error", (err: Error) =>
      reject(
        err.message.includes("ENOENT")
          ? new Error(`${path.basename(bin)} is not installed or not on PATH.`)
          : err
      )
    );
    proc.on("close", (code: number | null) =>
      code === 0
        ? resolve()
        : reject(new Error(`${path.basename(bin)} exited with code ${code}: ${stderr.slice(-500)}`))
    );
  });
}

/** Failure signatures from yt-dlp that are almost always transient throttling, not a real block. */
const TRANSIENT_YTDLP_ERROR = /HTTP Error 403|HTTP Error 429|Read timed out|Connection reset|Temporary failure/i;

/**
 * Like run(), but retries once on yt-dlp's transient throttling errors (YouTube's
 * bot-detection intermittently 403s a fresh request that succeeds moments later).
 * Non-transient failures (bad URL, missing binary, private/deleted video) fail fast.
 */
export async function runYtDlpWithRetry(args: string[], retries = 1, delayMs = 3000): Promise<void> {
  const bin = resolveBin("yt-dlp");
  for (let attempt = 0; ; attempt++) {
    try {
      await run(bin, args);
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
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
