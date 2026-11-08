import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { withYoutubeCookies, youtubeCookiesFile } from "../lib/youtube-cookies.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");
const COOKIES = "# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tabc123\n";
const b64 = Buffer.from(COOKIES).toString("base64");
const YT = ["-f", "best", "https://www.youtube.com/watch?v=abcdefghijk"];

test("with no cookies set, yt-dlp arguments are never changed", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "klyp-ck-"));
  assert.deepEqual(withYoutubeCookies(YT, {}, dir), YT);
  assert.deepEqual(withYoutubeCookies(YT, { YOUTUBE_COOKIES_B64: "   " }, dir), YT);
});

test("with cookies set, a YouTube link gets --cookies and a private file with the cookies in it", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "klyp-ck-"));
  const args = withYoutubeCookies(YT, { YOUTUBE_COOKIES_B64: b64 }, dir);
  assert.equal(args[0], "--cookies");
  assert.deepEqual(args.slice(2), YT);
  assert.ok(existsSync(args[1]));
  assert.equal(readFileSync(args[1], "utf8"), COOKIES);
});

test("other sites never get the YouTube cookies", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "klyp-ck-"));
  for (const url of ["https://www.twitch.tv/videos/123", "https://kick.com/streamer/videos/01a184df-0210-7042-879d-c811b7e04bbf", "https://notyoutube.com/watch?v=1"]) {
    const args = ["-f", "best", url];
    assert.deepEqual(withYoutubeCookies(args, { YOUTUBE_COOKIES_B64: b64 }, dir), args, url);
  }
});

test("junk in the setting is ignored instead of being handed to yt-dlp", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "klyp-ck-"));
  assert.equal(youtubeCookiesFile({ YOUTUBE_COOKIES_B64: Buffer.from("not a cookie file").toString("base64") }, dir), null);
  assert.deepEqual(withYoutubeCookies(YT, { YOUTUBE_COOKIES_B64: Buffer.from("hello youtube.com but no tabs").toString("base64") }, dir), YT);
});

test("an argument list that already names cookies is left alone", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "klyp-ck-"));
  const args = ["--cookies", "/other.txt", ...YT];
  assert.deepEqual(withYoutubeCookies(args, { YOUTUBE_COOKIES_B64: b64 }, dir), args);
});

test("both yt-dlp runners use the cookies, and the setting is documented", () => {
  const bin = read("lib/bin.ts");
  assert.match(bin, /import \{ withYoutubeCookies \} from "\.\/youtube-cookies\.ts";/);
  assert.equal((bin.match(/withYoutubeCookies\(plainArgs\)/g) ?? []).length, 2);
  assert.match(read(".env.example"), /YOUTUBE_COOKIES_B64/);
});

test("a clip saved with no usable source link is marked unavailable at once, not retried 8 times", () => {
  const worker = read("lib/clip-archive-worker.ts");
  assert.match(worker, /\|is not a valid URL\/i\.test\(message\)/);
});

test("a video with no speech gets a plain message and no charge, not a raw provider error", () => {
  const pipe = read("lib/analyze-pipeline.ts");
  assert.match(pipe, /no spoken audio\|no speech/);
  assert.match(pipe, /We couldn't hear any speech in this video, so there's nothing to clip\. No Sparks were charged\./);
});
