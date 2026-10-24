import { spawn, type ChildProcess } from "child_process";
import { existsSync } from "fs";
import os from "os";
import path from "path";
import { shouldRetryYouTubeOverIpv6 } from "./youtube-ipv6-fallback.ts";

/**
 * Proof for the ffmpeg -9 kills on /api/preview (2026-08-08): the exact same
 * segment, same args, completed cleanly in 21s on a 24-core dev machine but
 * died to SIGKILL within ~7s on every attempt on Railway (2 vCPU per
 * `railway metrics`). libx264 auto-detects thread/lookahead-buffer count from
 * the HOST's full core count, not the container's cgroup CPU quota — on a
 * shared host with far more cores than the container is actually allotted,
 * that overcommits memory almost immediately and gets OOM-killed long before
 * any output is written (size stays 0kB). Logged once per boot so a future
 * container's real os.cpus().length is on record instead of inferred.
 */
console.log(`[bin] container reports ${os.cpus().length} logical CPU(s) (os.cpus().length)`);

/**
 * Thread cap passed to every ffmpeg invocation (directly, and via yt-dlp's
 * --postprocessor-args) to stop libx264 from overcommitting threads/lookahead
 * buffers based on the host's core count instead of this container's actual
 * CPU allocation. Override with FFMPEG_THREADS if the service's vCPU limit
 * changes — keep it in sync with the Railway service's CPU limit.
 */
export const FFMPEG_THREADS = Number(process.env.FFMPEG_THREADS) || 2;

/**
 * Thread-cap args for every yt-dlp-invoked ffmpeg process. There are TWO
 * distinct ffmpeg call sites inside yt-dlp and they take the cap through
 * DIFFERENT flags — this is the actual bug behind the recurring -9 kills on
 * /api/preview (2026-08-10), confirmed live: with --download-sections +
 * --force-keyframes-at-cuts (used by resolveSourceSegment / the audio-window
 * downloader), yt-dlp does the keyframe-accurate cut via its ffmpeg-based
 * DOWNLOADER, not a postprocessor. --postprocessor-args never reaches that
 * process — verified with --verbose: libx264 banner still read `threads=24`
 * with only --postprocessor-args set, and only dropped to `threads=2` once
 * --downloader-args was added. --postprocessor-args is still needed for the
 * OTHER ffmpeg call site (the post-download bestvideo+bestaudio merge, e.g.
 * on ensureSourceVideo's full-download path, which doesn't go through the
 * downloader). Passing both is safe — whichever one a given yt-dlp
 * invocation doesn't use is simply ignored.
 */
export function ytDlpThreadCapArgs(): string[] {
  return [
    "--downloader-args", `ffmpeg:-threads ${FFMPEG_THREADS}`,
    "--postprocessor-args", `ffmpeg:-threads ${FFMPEG_THREADS}`,
  ];
}

export type RunOptions = {
  /** Kill the process if it emits no stdout/stderr for this long (stalled). */
  stallTimeoutMs?: number;
  /** Kill the process if it runs longer than this in total. */
  maxRunMs?: number;
};

/** Preserve actionable process failure identity while retaining existing Error messages. */
export class ProcessRunError extends Error {
  readonly kind: "spawn" | "timeout" | "signal" | "resource" | "exit";
  readonly code?: string;
  readonly exitCode?: number | null;
  readonly signal?: NodeJS.Signals | null;
  constructor(message: string, details: {
    kind: ProcessRunError["kind"]; code?: string; exitCode?: number | null;
    signal?: NodeJS.Signals | null; cause?: unknown;
  }) {
    super(message, { cause: details.cause });
    this.name = "ProcessRunError";
    this.kind = details.kind;
    this.code = details.code;
    this.exitCode = details.exitCode;
    this.signal = details.signal;
  }
}

export function isProcessInfrastructureError(error: unknown): boolean {
  return error instanceof ProcessRunError && error.kind !== "exit";
}

/**
 * Kill a process AND its children. yt-dlp spawns ffmpeg, and killing only the
 * parent leaves ffmpeg alive holding the stdout/stderr pipes it inherited —
 * which means the parent's 'close' event never fires, the promise never
 * settles, and the request wedges forever while the orphan keeps writing.
 * That is exactly what hung a job for 10 hours and then OOM'd the container.
 *
 * On Unix this needs the child to be its own process-group leader — see
 * `detached` in spawnProcess() — so a negative pid signals the whole group.
 */
function killTree(proc: ChildProcess) {
  if (!proc.pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { windowsHide: true });
    return;
  }
  try {
    process.kill(-proc.pid, "SIGKILL"); // whole process group
  } catch {
    try {
      proc.kill("SIGKILL"); // group is gone; fall back to the process itself
    } catch {
      // already dead — nothing to do
    }
  }
}

/**
 * Cap on retained child output. We only ever report the last few hundred
 * characters, but an orphaned grandchild can emit progress lines for hours —
 * appending them unbounded is what grew the heap to ~475MB and crashed the
 * container. Keeping a bounded tail makes that leak structurally impossible.
 */
const MAX_RETAINED_OUTPUT = 16 * 1024;

function appendCapped(buf: string, chunk: string): string {
  const next = buf + chunk;
  return next.length > MAX_RETAINED_OUTPUT ? next.slice(-MAX_RETAINED_OUTPUT) : next;
}

/** Grace period for stdio to flush after 'exit' before we settle without 'close'. */
const CLOSE_GRACE_MS = 3000;

/**
 * Detects a disk-full failure from process stderr. Both yt-dlp and ffmpeg
 * write with no free-space check up front, so a full disk otherwise surfaces
 * as an opaque "exited with code 1" — this turns it into an actionable error.
 */
function isDiskSpaceError(text: string): boolean {
  return /no space left on device|not enough space|disk full|enospc|free disk space/i.test(text);
}

/**
 * `--ffmpeg-location` arguments for yt-dlp — empty when we couldn't resolve a
 * real path.
 *
 * yt-dlp treats this flag's value as a filesystem path, NOT a command to look
 * up on PATH. Passing the bare name "ffmpeg" made it log
 * `WARNING: ffmpeg-location ffmpeg does not exist! Continuing without ffmpeg`
 * and then run with no ffmpeg at all — which fails every m3u8/HLS download,
 * i.e. every Twitch VOD, with "m3u8 download detected but ffmpeg could not be
 * found". Omitting the flag entirely is strictly better than passing a bogus
 * path: yt-dlp then finds ffmpeg on PATH by itself.
 */
export function ffmpegLocationArgs(): string[] {
  const resolved = resolveBin("ffmpeg");
  return path.isAbsolute(resolved) && existsSync(/* turbopackIgnore: true */ resolved) ? ["--ffmpeg-location", resolved] : [];
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

  // Unix: resolve to a real absolute path. Railpack installs apt packages
  // into /usr/bin and the yt-dlp postinstall drops its binary in /app/bin.
  // Returning the bare name here is what broke every Twitch VOD — see
  // ffmpegLocationArgs() below.
  if (process.platform !== "win32") {
    for (const dir of ["/app/bin", "/usr/local/bin", "/usr/bin", "/bin", "/opt/homebrew/bin"]) {
      const candidate = path.join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
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

/**
 * Shared spawn core for run()/runCapture().
 *
 * Guarantees the returned promise ALWAYS settles:
 *   - the child is its own process group, so killTree() reaps grandchildren
 *   - settlement is driven by 'exit' (which fires when the process dies) with
 *     'close' only preferred when it arrives first, so a grandchild holding
 *     the inherited pipes open can no longer wedge us
 *   - retained output is bounded, so a chatty orphan can't grow the heap
 */
function spawnProcess(bin: string, args: string[], opts: RunOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, {
      windowsHide: true,
      // Unix: make the child a process-group leader so killTree() can signal
      // the entire group (yt-dlp + the ffmpeg it spawns).
      detached: process.platform !== "win32",
    });

    let stdout = "";
    let stderr = "";
    let killReason: string | null = null;
    let settled = false;

    let stallTimer: NodeJS.Timeout | undefined;
    let maxTimer: NodeJS.Timeout | undefined;
    let graceTimer: NodeJS.Timeout | undefined;

    const cleanup = () => {
      clearTimeout(stallTimer);
      clearTimeout(maxTimer);
      clearTimeout(graceTimer);
    };

    const conclude = (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (killReason) {
        reject(new ProcessRunError(`${path.basename(bin)} ${killReason}. stderr: ${stderr.slice(-300)}`, { kind: "timeout", exitCode: code, signal }));
      } else if (code === 0) {
        resolve(stdout);
      } else {
        const tail = stderr.slice(-500);
        const diskFull = isDiskSpaceError(tail);
        const resourceFailure = diskFull || /cannot allocate memory|out of memory|resource temporarily unavailable|too many open files|pthread_create.*failed|cannot create thread/i.test(tail);
        reject(new ProcessRunError(
          diskFull ? `${path.basename(bin)} ${DISK_SPACE_ERROR_MESSAGE}` : `${path.basename(bin)} exited with code ${code}: ${tail}`,
          { kind: signal || (code !== null && code < 0) ? "signal" : resourceFailure ? "resource" : "exit", exitCode: code, signal }
        ));
      }
    };

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const resetStall = () => {
      if (!opts.stallTimeoutMs) return;
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        killReason = `stalled — no output for ${Math.round(opts.stallTimeoutMs! / 1000)}s`;
        killTree(proc);
      }, opts.stallTimeoutMs);
    };
    resetStall();

    if (opts.maxRunMs) {
      maxTimer = setTimeout(() => {
        killReason = `timed out after ${Math.round(opts.maxRunMs! / 1000)}s`;
        killTree(proc);
      }, opts.maxRunMs);
    }

    proc.stdout.on("data", (d: Buffer) => {
      stdout = appendCapped(stdout, d.toString());
      resetStall();
    });
    proc.stderr.on("data", (d: Buffer) => {
      stderr = appendCapped(stderr, d.toString());
      resetStall();
    });

    proc.on("error", (err: NodeJS.ErrnoException) => {
      fail(new ProcessRunError(
        err.code === "ENOENT" || err.message.includes("ENOENT")
          ? `${path.basename(bin)} is not installed or not on PATH.` : err.message,
        { kind: "spawn", code: err.code, cause: err }
      ));
    });

    // 'close' waits for every inherited pipe to close, which an orphaned
    // grandchild can delay indefinitely. 'exit' fires as soon as the process
    // itself is gone, so use it as a backstop after a short flush grace.
    proc.on("exit", (code: number | null, signal: NodeJS.Signals | null) => {
      clearTimeout(stallTimer);
      clearTimeout(maxTimer);
      graceTimer = setTimeout(() => conclude(code, signal), CLOSE_GRACE_MS);
    });
    proc.on("close", (code: number | null, signal: NodeJS.Signals | null) => conclude(code, signal));
  });
}

/** Like run(), but resolves with the process's stdout. Supports the same timeouts. */
export function runCapture(bin: string, args: string[], opts: RunOptions = {}): Promise<string> {
  return spawnProcess(bin, args, opts);
}

/** Capture yt-dlp metadata, retrying a YouTube bot challenge over IPv6. */
export async function runYtDlpCaptureWithIpv6Fallback(args: string[], opts: RunOptions = {}): Promise<string> {
  const bin = resolveBin("yt-dlp");
  try {
    return await runCapture(bin, args, opts);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!shouldRetryYouTubeOverIpv6(args, message)) throw err;
    console.error("[yt-dlp] metadata request failed:", message);
    try {
      return await runCapture(bin, ["--force-ipv6", ...args], opts);
    } catch (ipv6Error) {
      console.error("[yt-dlp] IPv6 metadata retry failed:", ipv6Error);
      throw err;
    }
  }
}

/** Spawn a process and resolve on exit 0, reject with stderr tail otherwise. */
export async function run(bin: string, args: string[], opts: RunOptions = {}): Promise<void> {
  await spawnProcess(bin, args, opts);
}

/** Failure signatures that mean the video host rejected/throttled the request. */
const TRANSIENT_THROTTLE_ERROR = /HTTP Error 403|HTTP Error 429|Read timed out|Connection reset|Temporary failure/i;
/**
 * Failure signatures that mean our own process got killed rather than
 * failing on its own — a stall (our watchdog) or ffmpeg dying to a signal
 * (negative exit code: SIGKILL/-9 from an OOM reaper, SIGSEGV, etc). These
 * are usually a brief resource blip on the container, not a deterministic
 * problem with the request, so a retry a few seconds later typically works —
 * confirmed live: an isolated ffmpeg -9 on a 44s /api/preview segment (an
 * unremarkable download, nowhere near the container's memory ceiling) died
 * instantly and was never retried because this regex didn't recognize it.
 */
const TRANSIENT_KILL_ERROR = /stalled — no output|ffmpeg exited with code -\d+/i;
const TRANSIENT_YTDLP_ERROR = new RegExp(
  `${TRANSIENT_THROTTLE_ERROR.source}|${TRANSIENT_KILL_ERROR.source}`,
  "i"
);

/**
 * Narrow yt-dlp output down to what actually failed.
 *
 * yt-dlp prefixes fatal failures with "ERROR:" and non-fatal noise with
 * "WARNING:". Classifying on the raw stderr tail let a benign warning
 * masquerade as the cause — a Twitch VOD emits
 * `WARNING: Unable to download JSON metadata: HTTP Error 403` on perfectly
 * successful downloads, so ANY later failure on that VOD matched the 403
 * branch and got reported as rate limiting.
 */
function fatalText(text: string): string {
  const lines = text.split(/\r?\n/);
  const errors = lines.filter((l) => /^\s*ERROR:/i.test(l));
  if (errors.length) return errors.join("\n");
  return lines.filter((l) => !/^\s*WARNING:/i.test(l)).join("\n");
}

/**
 * Friendly wording for a transient failure that still names the real cause.
 * Only shown after the automatic retry has ALREADY been attempted and ALSO
 * failed — so it must not claim retrying will help; that already happened
 * and didn't. ("retrying usually fixes this" claimed exactly that and was
 * wrong every time this fired on the ffmpeg-thread-overcommit bug — same
 * failure, twice, back to back.)
 */
function transientMessage(raw: string): string {
  const text = fatalText(raw);
  const detail = (text.match(/ERROR:.*/i)?.[0] ?? "").trim().slice(0, 200);
  // A kill (stall/SIGKILL) is our process dying, not the host rejecting us —
  // don't blame "the video host" for something that happened on our end.
  const base = TRANSIENT_KILL_ERROR.test(text) && !TRANSIENT_THROTTLE_ERROR.test(text)
    ? "This download was interrupted twice in a row by a server-side resource issue, not something wrong with the video. Try again in a bit — if it keeps failing on the same clip, that's worth reporting."
    : "The video host rejected or throttled this download twice in a row — wait a few minutes before trying again.";
  return base + (detail ? ` (yt-dlp: ${detail})` : "");
}

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
  let triedIpv6 = false;
  for (let attempt = 0; ; attempt++) {
    try {
      await run(bin, args, opts);
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Always log what yt-dlp actually said. The friendly message below
      // replaces it, and without this line the real cause never reaches the
      // logs at all — which is exactly what made a Twitch 403 undiagnosable.
      console.error("[yt-dlp] attempt", attempt + 1, "failed:", message);
      if (!triedIpv6 && shouldRetryYouTubeOverIpv6(args, message)) {
        triedIpv6 = true;
        try {
          await run(bin, ["--force-ipv6", ...args], opts);
          return;
        } catch (ipv6Error) {
          console.error("[yt-dlp] IPv6 retry failed:", ipv6Error);
          // Keep the original bot challenge so the UI can offer file upload.
        }
      }
      // Check disk-full FIRST. A download that wedges because the drive is
      // full gets killed by stallTimeoutMs, which looks "transient" — and
      // was then reported as rate limiting, sending people chasing a
      // throttling problem they don't have.
      if (isDiskSpaceError(message)) throw err;
      const transient = TRANSIENT_YTDLP_ERROR.test(fatalText(message));
      if (!transient || attempt >= retries) {
        throw transient ? new Error(transientMessage(message)) : err;
      }
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}
