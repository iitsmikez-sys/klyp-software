/**
 * Optional YouTube login cookies for yt-dlp. YouTube often answers a cloud server with "Sign in to confirm you're
 * not a bot". Giving yt-dlp the cookies of a throwaway Google account (never a personal one) makes the server look
 * like a signed-in viewer. It is OFF unless YOUTUBE_COOKIES_B64 is set (a cookies.txt in the Netscape format, base64
 * encoded) and only ever touches YouTube links. The cookies expire after a few weeks and must be exported again.
 */
import { chmodSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const COOKIE_FILE = "klyp-youtube-cookies.txt";
const YOUTUBE_URL = /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\//i;

let written: { value: string; file: string } | null = null;

/** The cookie file path, written once per distinct value, or null when nothing usable is set. */
export function youtubeCookiesFile(env: Record<string, string | undefined> = process.env, dir = tmpdir()): string | null {
  const value = env.YOUTUBE_COOKIES_B64?.trim();
  if (!value) return null;
  const file = path.join(dir, COOKIE_FILE);
  if (written && written.value === value && written.file === file) return file;
  let text: string;
  try { text = Buffer.from(value, "base64").toString("utf8"); } catch { return null; }
  // A real export names youtube.com; anything else is ignored rather than handed to yt-dlp.
  if (!/youtube\.com/i.test(text) || !/\t/.test(text)) return null;
  try {
    writeFileSync(file, text, { mode: 0o600 });
    try { chmodSync(file, 0o600); } catch { /* not supported everywhere */ }
  } catch { return null; }
  written = { value, file };
  return file;
}

/** yt-dlp arguments with the cookies added, for YouTube links only. Anything else comes back unchanged. */
export function withYoutubeCookies(args: string[], env: Record<string, string | undefined> = process.env, dir = tmpdir()): string[] {
  if (args.includes("--cookies") || !args.some((arg) => YOUTUBE_URL.test(arg))) return args;
  const file = youtubeCookiesFile(env, dir);
  return file ? ["--cookies", file, ...args] : args;
}
