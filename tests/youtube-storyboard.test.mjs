import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseMhtmlImages, storyboardTile, storyboardMetaFromInfo } from "../lib/storyboard-math.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");

/** A small file laid out the way yt-dlp writes a storyboard .mhtml: a text part, then images with Content-length and raw bytes. */
function mhtml(images, { eol = "\n" } = {}) {
  const B = "b0undary123";
  const parts = [Buffer.from(`MIME-Version: 1.0${eol}Content-type: multipart/related; boundary="${B}"; type="text/html"${eol}${eol}--${B}${eol}Content-Type: text/html; charset=utf-8${eol}Content-Length: 5${eol}${eol}<hi/>`)];
  for (const [i, bytes] of images.entries()) {
    parts.push(Buffer.from(`${eol}--${B}${eol}Content-ID: <${i}@x>${eol}Content-type: image/webp${eol}Content-length: ${bytes.length}${eol}Content-location: https://i.ytimg.com/sb/x/M${i}.jpg${eol}X.yt-dlp.Duration: 89.7${eol}${eol}`), Buffer.from(bytes));
  }
  parts.push(Buffer.from(`${eol}--${B}--${eol}`));
  return Buffer.concat(parts);
}

test("the sheets are read out of the file exactly, even when the picture bytes contain blank lines", () => {
  const a = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 255, 10, 10, 13, 10, 13, 10, 45, 45]), Buffer.from("WEBPDATA-A")]);
  const b = Buffer.from("RIFF-second-sheet\n\n--not-the-boundary\n\nend");
  const sheets = parseMhtmlImages(mhtml([a, b]));
  assert.equal(sheets.length, 2, "the text part is skipped, both images are kept");
  assert.deepEqual(Buffer.from(sheets[0]), a);
  assert.deepEqual(Buffer.from(sheets[1]), b);
  assert.equal(parseMhtmlImages(mhtml([a, b], { eol: "\r\n" })).length, 2, "Windows line endings too");
  assert.deepEqual(parseMhtmlImages(Buffer.from("not a storyboard")), []);
});

const meta = { tileWidth: 320, tileHeight: 180, rows: 3, columns: 3, fps: 0.10031618281115263, sheetCount: 39 };

test("a moment in the video maps to the right sheet and tile (checked on the real MrBeast storyboard)", () => {
  assert.deepEqual(storyboardTile(meta, 0), { sheet: 0, row: 0, column: 0, x: 0, y: 0 });
  assert.deepEqual(storyboardTile(meta, 904.691), { sheet: 10, row: 0, column: 0, x: 0, y: 0 }, "15:04 is the first tile of sheet 10");
  const t = storyboardTile(meta, 3114.9);
  assert.deepEqual([t.sheet, t.row, t.column, t.x, t.y], [34, 2, 0, 0, 360]);
  // Every second of the video lands on a real tile, never past the last sheet.
  for (let s = 0; s <= 3600; s += 7) { const k = storyboardTile(meta, s); assert.ok(k.sheet >= 0 && k.sheet < 39 && k.x <= 640 && k.y <= 360, String(s)); }
  assert.equal(storyboardTile(meta, 99999).sheet, 38, "past the end uses the last sheet");
  assert.equal(storyboardTile(meta, -5).sheet, 0, "before the start uses the first");
});

test("the layout is read from yt-dlp's info, and anything missing or odd is refused", () => {
  const info = { requested_formats: [{ format_id: "sb0", width: 320, height: 180, rows: 3, columns: 3, fps: 0.1003 }] };
  assert.deepEqual(storyboardMetaFromInfo(info, 39), { tileWidth: 320, tileHeight: 180, rows: 3, columns: 3, fps: 0.1003, sheetCount: 39 });
  assert.equal(storyboardMetaFromInfo({ format_id: "sb1", formats: [{ format_id: "sb1", width: 160, height: 90, rows: 5, columns: 5, fps: 0.2 }] }, 3)?.tileWidth, 160);
  assert.equal(storyboardMetaFromInfo(null, 3), null);
  assert.equal(storyboardMetaFromInfo({ requested_formats: [{ width: 320 }] }, 3), null);
  assert.equal(storyboardMetaFromInfo(info, 0), null, "no sheets, no storyboard");
});

test("the thumbnail route tries the storyboard for YouTube first and falls back to a small video slice", () => {
  const route = read("app/api/thumbnail/route.ts");
  assert.ok(route.includes("if (isYouTubeRef(url)) {") && route.includes("await youtubeStoryboardFrame(url, mid, outPath);"));
  assert.ok(route.indexOf("youtubeStoryboardFrame(url, mid, outPath)") < route.indexOf("await resolveSourceSegment("), "storyboard first");
  assert.ok(route.includes("storyboard not used, cutting from video"), "the fallback is logged");
  const sb = read("lib/youtube-storyboard.ts");
  assert.ok(sb.includes('"-f", "sb0/sb1/sb2"'), "best size first, smaller ones as fallback");
  assert.ok(sb.includes("runYtDlpWithRetry("), "goes through the same downloader as everything else (cookies, cooldown, retries)");
  assert.ok(sb.indexOf("writeFile(metaPath") > sb.indexOf("writeFile(path.join(dir, `s${i}.webp`)"), "meta.json is written last");
  assert.ok(sb.includes("rm(dir, { recursive: true, force: true })"), "no half-made folders after a failure");
  assert.ok(sb.includes("STORYBOARD_MAX_AGE_MS = 7 * 24 * 3600_000") && sb.includes('name.startsWith("sb-")'), "week-old storyboard folders are removed");
});
