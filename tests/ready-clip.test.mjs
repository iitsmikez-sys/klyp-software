import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  READY_CLIP_LAYOUT, READY_CLIP_STYLE, READY_CLIP_HOOK_STYLE, readyClipRequest,
} from "../lib/ready-clip.ts";
import { CAPTION_STYLES } from "../lib/clips.ts";
import { HOOK_STYLES } from "../lib/captions.ts";
import { validateVerticalLayout, planVerticalLayout } from "../lib/vertical-layout.ts";
import { buildVerticalFilterGraph } from "../lib/vertical-layout-ffmpeg.ts";

const clip = {
  title: "Insane 1v4 clutch", start_seconds: 100, end_seconds: 140,
  words: [{ text: "no", start: 100000, end: 100300 }], hooks: ["He did WHAT?!", "Second hook"],
};

test("the recipe uses real styles: white box hook and Pulse captions", () => {
  assert.equal(READY_CLIP_STYLE, "PULSE");
  assert.equal(READY_CLIP_HOOK_STYLE, "WHITE_BOX");
  assert.ok(CAPTION_STYLES.includes(READY_CLIP_STYLE));
  assert.ok(HOOK_STYLES.includes(READY_CLIP_HOOK_STYLE));
});

test("the ready clip request carries the AI's first hook and the fixed look", () => {
  const body = readyClipRequest(clip, { url: "https://twitch.tv/videos/1", clipId: "abc", handle: "karmic" });
  assert.equal(body.hook, "He did WHAT?!");
  assert.equal(body.hook_style, "WHITE_BOX");
  assert.equal(body.style, "PULSE");
  assert.equal(body.aspect_ratio, "9:16");
  assert.equal(body.clip_id, "abc");
  assert.equal(body.handle, "karmic");
  assert.deepEqual(body.words, clip.words);
  assert.deepEqual(body.vertical_layout, READY_CLIP_LAYOUT);
});

test("a hook set on the results page wins, and no hook means none is burned", () => {
  assert.equal(readyClipRequest(clip, { url: "u", hook: "Edited hook" }).hook, "Edited hook");
  assert.equal(readyClipRequest({ ...clip, hooks: null }, { url: "u" }).hook, undefined);
  assert.equal(readyClipRequest({ ...clip, hooks: [] }, { url: "u", hook: null }).hook, undefined);
});

test("the server accepts the layout and zooms a 16:9 source into a square over a blurred background", () => {
  const layout = validateVerticalLayout(READY_CLIP_LAYOUT);
  const plan = planVerticalLayout({ w: 1920, h: 1080 }, layout, { w: 1080, h: 1920 });
  assert.equal(plan.mode, "full_frame");
  // About two thirds of the 1920px height, sides cropped past the 1080px canvas.
  assert.ok(plan.dest.h >= 1250 && plan.dest.h <= 1300, `video height ${plan.dest.h}`);
  assert.ok(plan.dest.w > 1080, `video width ${plan.dest.w}`);
  assert.equal(plan.dest.y, Math.round((1920 - plan.dest.h) / 2 / 2) * 2);
});

test("a real render is 1080x1920 with the video centred and a blurred, non-black background", () => {
  const dir = mkdtempSync(join(tmpdir(), "klyp-ready-"));
  try {
    const source = join(dir, "source.mp4"), output = join(dir, "ready.mp4");
    // Left half red, right half blue so the crop and centring are visible.
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i",
      "color=c=red:size=640x360:rate=10:duration=1,drawbox=x=320:y=0:w=320:h=360:color=blue:t=fill",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", source]);
    const plan = planVerticalLayout({ w: 640, h: 360 }, validateVerticalLayout(READY_CLIP_LAYOUT), { w: 1080, h: 1920 });
    const { filter, videoLabel } = buildVerticalFilterGraph(plan, []);
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", source, "-filter_complex", filter,
      "-map", `[${videoLabel}]`, "-c:v", "libx264", "-pix_fmt", "yuv420p", output]);
    const size = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=width,height", "-of", "csv=p=0", output]).toString().trim();
    assert.equal(size, "1080,1920");
    const frame = execFileSync("ffmpeg", ["-loglevel", "error", "-ss", "0.5", "-i", output,
      "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 1080 * 1920 * 4 });
    const px = (x, y) => [...frame.subarray((y * 1080 + x) * 3, (y * 1080 + x) * 3 + 3)];
    const leftOfVideo = px(200, 960), rightOfVideo = px(900, 960), top = px(540, 20);
    assert.ok(leftOfVideo[0] > leftOfVideo[2] + 80, `left should be red, got ${leftOfVideo}`);
    assert.ok(rightOfVideo[2] > rightOfVideo[0] + 80, `right should be blue, got ${rightOfVideo}`);
    assert.ok(top[0] + top[1] + top[2] > 60, `top band should be a blurred copy, not black: ${top}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("every place a clip is downloaded offers 'Download ready clip' as the main button", () => {
  const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  for (const file of ["components/FoundClipCard.tsx", "components/ResultsClipPreviewModal.tsx", "components/ClipPreviewModal.tsx", "components/CompactClipCard.tsx"]) {
    assert.match(read(file), /Download ready clip/, file);
  }
  // Edit is now the quiet button; Download Raw stays.
  assert.doesNotMatch(read("components/FoundClipCard.tsx"), />Edit Clip</);
  assert.match(read("components/FoundClipCard.tsx"), /Download Raw/);
  // Download all (.zip) renders every clip with the ready recipe.
  assert.match(read("components/AnalyzePanel.tsx"), /fetchClipBlob\(clips\[i\], clipStyles\[i\] \?\? "BOLD", i, false, true\)/);
  // No Settings section for it, and no hook row in the card.
  assert.doesNotMatch(read("app/(dashboard)/dashboard/settings/page.tsx"), /Ready clip style/i);
});
