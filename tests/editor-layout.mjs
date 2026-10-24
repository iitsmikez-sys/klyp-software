import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEditorLayout } from "../lib/editor-layout.ts";
import { buildEditorMediaFilter } from "../lib/editor-media-render.ts";

test("manual layout values are bounded before entering FFmpeg", () => {
  assert.deepEqual(parseEditorLayout(undefined).mode, "FILL");
  assert.equal(parseEditorLayout({ mode: "FACECAM", x: 0.7, y: 0.2,
    face: { x: 0.68, y: 0, w: 0.3, h: 0.35 } }).mode, "FACECAM");
  assert.throws(() => parseEditorLayout({ mode: "FILL", x: "0;movie=evil", y: 0.5 }));
  assert.throws(() => parseEditorLayout({ mode: "FACECAM", x: 0.5, y: 0.5,
    face: { x: 0.8, y: 0, w: 0.3, h: 0.3 } }));
});

test("manual crop changes the rendered source region", () => {
  const dir = mkdtempSync(join(tmpdir(), "klyp-layout-"));
  try {
    const source = join(dir, "source.mp4"), output = join(dir, "crop.mp4");
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i",
      "color=c=red:size=160x90:rate=10:duration=1,drawbox=x=80:y=0:w=80:h=90:color=blue:t=fill",
      "-c:v", "libx264", source]);
    const layout = parseEditorLayout({ mode: "FILL", x: 1, y: 0.5 });
    const { graph, videoLabel, audioLabel } = buildEditorMediaFilter(
      [{ start: 0, end: 1 }], [], false, [], 90, 160, undefined, layout);
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", source,
      "-filter_complex", graph, "-map", videoLabel, "-map", audioLabel, "-c:v", "libx264", output]);
    const bytes = execFileSync("ffmpeg", ["-loglevel", "error", "-ss", "0.5", "-i", output,
      "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 90 * 160 * 4 });
    const center = [...bytes.subarray((80 * 90 + 45) * 3, (80 * 90 + 45) * 3 + 3)];
    assert.ok(center[2] > center[0] + 80, `expected blue right side, got ${center}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("facecam layout builds separate upper and gameplay regions", () => {
  const layout = parseEditorLayout({ mode: "FACECAM", x: 0.5, y: 0.5,
    face: { x: 0.68, y: 0, w: 0.3, h: 0.35 } });
  const { graph } = buildEditorMediaFilter([{ start: 0, end: 2 }], [], false, [],
    108, 192, undefined, layout);
  assert.match(graph, /vstack=inputs=2/);
  assert.match(graph, /crop=iw\*0\.3:ih\*0\.35/);
});

test("facecam and gameplay are both present in the rendered output", () => {
  const dir = mkdtempSync(join(tmpdir(), "klyp-facecam-"));
  try {
    const source = join(dir, "source.mp4"), output = join(dir, "layout.mp4");
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i",
      "color=c=red:size=160x90:rate=10:duration=1,drawbox=x=108:y=0:w=52:h=32:color=green:t=fill",
      "-c:v", "libx264", source]);
    const layout = parseEditorLayout({ mode: "FACECAM", x: 0.5, y: 0.5,
      face: { x: 0.68, y: 0, w: 0.3, h: 0.35 } });
    const { graph, videoLabel, audioLabel } = buildEditorMediaFilter(
      [{ start: 0, end: 1 }], [], false, [], 90, 160, undefined, layout);
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", source,
      "-filter_complex", graph, "-map", videoLabel, "-map", audioLabel,
      "-c:v", "libx264", output]);
    const bytes = execFileSync("ffmpeg", ["-loglevel", "error", "-ss", "0.5", "-i", output,
      "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 90 * 160 * 4 });
    const pixel = (y) => [...bytes.subarray((y * 90 + 45) * 3, (y * 90 + 45) * 3 + 3)];
    const top = pixel(20), bottom = pixel(130);
    assert.ok(top[1] > top[0] + 30, `expected green facecam, got ${top}`);
    assert.ok(bottom[0] > bottom[1] + 80, `expected red gameplay, got ${bottom}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
