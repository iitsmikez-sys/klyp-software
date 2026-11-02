import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ffmpegLocationArgs, resolveBin } from "@/lib/bin";

const execFileAsync = promisify(execFile);

/**
 * Best-effort, failure-path-only probe: ask yt-dlp for the stream URLs of a VOD slice, then let
 * ffmpeg read 4 seconds of each at the slice's start and report what it can open. The output goes
 * to the server log ("[segment-diagnose]"), because a failed slice otherwise only says that an
 * encoder "could not open", not whether Twitch returned HTTP errors, empty playlists or nothing.
 */
export async function diagnoseSegment(ref: string, format: string, startSeconds: number): Promise<string> {
  const out: string[] = [];
  try {
    const { stdout } = await execFileAsync(resolveBin("yt-dlp"), ["-g", "-f", format, "--no-playlist", ...ffmpegLocationArgs(), ref],
      { timeout: 25_000, maxBuffer: 256 * 1024 });
    const urls = stdout.split(/\r?\n/).map((u) => u.trim()).filter(Boolean).slice(0, 2);
    out.push(`urls=${urls.length} versions=ffmpeg`);
    for (const [i, url] of urls.entries()) {
      try {
        const { stderr } = await execFileAsync(resolveBin("ffmpeg"), ["-hide_banner", "-loglevel", "info", "-ss", String(startSeconds), "-t", "4", "-i", url, "-f", "null", "-"],
          { timeout: 30_000, maxBuffer: 512 * 1024 });
        out.push(`input${i}: ${stderr.replace(/\s+/g, " ").slice(-500)}`);
      } catch (err) {
        const e = err as { stderr?: string; message?: string };
        out.push(`input${i} FAILED: ${(e.stderr || e.message || "").replace(/\s+/g, " ").slice(-500)}`);
      }
    }
    const { stdout: v } = await execFileAsync(resolveBin("ffmpeg"), ["-version"], { timeout: 10_000 }).catch(() => ({ stdout: "" }));
    out.push(`ffmpeg: ${v.split("\n")[0]}`);
  } catch (err) {
    out.push(`diagnose failed: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`);
  }
  return out.join(" | ");
}
