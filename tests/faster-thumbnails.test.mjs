import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");

test("a frame is cut from a few seconds of small video around the middle of the clip, not the whole clip at 720p", () => {
  const route = read("app/api/thumbnail/route.ts");
  assert.ok(route.includes("const FRAME_SLICE_BEFORE_SECONDS = 1;") && route.includes("const FRAME_SLICE_AFTER_SECONDS = 3;"));
  assert.ok(route.includes("const FRAME_SLICE_HEIGHT = 360;"));
  assert.ok(route.includes("url, Math.max(0, mid - FRAME_SLICE_BEFORE_SECONDS), mid + FRAME_SLICE_AFTER_SECONDS, FRAME_SLICE_HEIGHT, FRAME_SLICE_MAX_MS, profile.id"));
  assert.ok(route.includes("await extractFrame(sourcePath, mid - offsetSeconds, outPath);"));
  assert.ok(!route.includes("resolveSourceSegment(url, start, end, 720"), "no more whole-clip 720p download for a still picture");
});

test("the frame time always falls inside the slice that is downloaded", () => {
  // resolveSourceSegment starts the file at floor(start) and ends it at ceil(end), and the frame is read at (middle - floor(start)).
  for (const [start, end] of [[875.147, 934.235], [3098.572, 3131.602], [0, 12], [5, 183], [520.818, 580.308], [1.2, 1.9 + 14]]) {
    const mid = start + (end - start) / 2;
    const segStart = Math.max(0, Math.floor(mid - 1)), segEnd = Math.ceil(mid + 3);
    const seek = mid - segStart;
    assert.ok(seek >= 0 && seek <= segEnd - segStart, `seek ${seek} inside ${segEnd - segStart}s for ${start}-${end}`);
    assert.ok(segEnd - segStart <= 5, "never more than 5 seconds of video");
    assert.ok(mid >= start && mid <= end, "and the frame is inside the clip itself");
  }
});

test("the cached frame name still depends on the exact clip range, so two clips never share a picture", () => {
  const route = read("app/api/thumbnail/route.ts");
  assert.ok(route.includes("`thumb-${THUMB_VERSION}-${source}-${Math.floor(start)}-${Math.ceil(end)}`"));
});
