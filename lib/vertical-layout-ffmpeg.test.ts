import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { planVerticalLayout } from "./vertical-layout.ts";
import { buildVerticalFilterGraph } from "./vertical-layout-ffmpeg.ts";

const source = { w: 1920, h: 1080 };
const output = { w: 1080, h: 1920 };
const gameplay = { x: 0.2, y: 0, w: 0.6, h: 1 };

test("full-frame fallback pads instead of cropping a 16:9 source", () => {
  const result = buildVerticalFilterGraph(planVerticalLayout(source, null, output), []);
  assert.match(result.filter, /scale=1080:1920:force_original_aspect_ratio=decrease/);
  assert.match(result.filter, /pad=1080:1920:\(ow-iw\)\/2:\(oh-ih\)\/2/);
  assert.equal(result.videoLabel, "outv");
});

test("composed graph crops gameplay, facecam and chat then fills vertical output", () => {
  const plan = planVerticalLayout(source, { version: 1, gameplay, facecam: { x: 0, y: 0.6, w: 0.2, h: 0.3 }, chat: { x: 0.8, y: 0.1, w: 0.2, h: 0.7 } }, output);
  const result = buildVerticalFilterGraph(plan, []);
  assert.match(result.filter, /split=4/);
  assert.match(result.filter, /overlay=540:1344/);
  assert.match(result.filter, /scale=1080:1344/);
  assert.equal(result.filter.endsWith("[outv]"), true);
});

test("text overlays are appended after composition", () => {
  const plan = planVerticalLayout(source, { version: 1, gameplay }, output);
  const result = buildVerticalFilterGraph(plan, ["drawtext=text='KLYP'"]);
  assert.match(result.filter, /\[mix0\]drawtext=text='KLYP',format=yuv420p,setsar=1\[outv\]$/);
});

test("FFmpeg renders gameplay, facecam and chat in their preview panels", (t) => {
  const check = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
  if (check.error) { t.skip("FFmpeg is unavailable"); return; }
  const layout = { version: 1 as const, gameplay: { x: 0.2, y: 0, w: 0.6, h: 1 }, facecam: { x: 0, y: 0.6, w: 0.2, h: 0.4 }, chat: { x: 0.8, y: 0, w: 0.2, h: 1 } };
  const graph = buildVerticalFilterGraph(planVerticalLayout({ w: 320, h: 180 }, layout, { w: 90, h: 160 }), []);
  const run = spawnSync("ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-i", "color=c=red:s=320x180:r=1:d=1,drawbox=x=0:y=108:w=64:h=72:color=blue:t=fill,drawbox=x=256:y=0:w=64:h=180:color=yellow:t=fill", "-filter_complex", graph.filter, "-map", `[${graph.videoLabel}]`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 2_000_000 });
  assert.equal(run.status, 0, run.stderr?.toString());
  const pixel = (x: number, y: number) => Array.from(run.stdout.subarray((y * 90 + x) * 3, (y * 90 + x) * 3 + 3));
  const top = pixel(45, 40), left = pixel(20, 140), right = pixel(70, 140);
  assert.ok(top[0] > 150 && top[1] < 80 && top[2] < 80, `gameplay ${top}`);
  assert.ok(left[2] > 100 && left[0] < 80, `facecam ${left}`);
  assert.ok(right[0] > 140 && right[1] > 140 && right[2] < 80, `chat ${right}`);
});

test("vertical export preserves an audio stream", (t) => {
  if (spawnSync("ffmpeg", ["-version"]).error) { t.skip("FFmpeg is unavailable"); return; }
  const dir = mkdtempSync(path.join(tmpdir(), "klyp-layout-test-"));
  try {
    const outputPath = path.join(dir, "clip.mp4");
    const graph = buildVerticalFilterGraph(planVerticalLayout({ w: 320, h: 180 }, null, { w: 90, h: 160 }), []);
    const run = spawnSync("ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-i", "color=c=red:s=320x180:r=10:d=1", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-filter_complex", graph.filter, "-map", `[${graph.videoLabel}]`, "-map", "1:a", "-c:v", "libx264", "-c:a", "aac", "-t", "1", "-y", outputPath], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    assert.ok(readFileSync(outputPath).byteLength > 0);
    const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height,sample_aspect_ratio,display_aspect_ratio", "-of", "json", outputPath], { encoding: "utf8" });
    assert.equal(probe.status, 0, probe.stderr);
    const streams = JSON.parse(probe.stdout).streams as { codec_type: string; width?: number; height?: number; sample_aspect_ratio?: string; display_aspect_ratio?: string }[];
    const picture = streams.find((stream) => stream.codec_type === "video");
    assert.equal(picture?.width, 90);
    assert.equal(picture?.height, 160);
    assert.equal(picture?.sample_aspect_ratio, "1:1");
    assert.equal(picture?.display_aspect_ratio, "9:16");
    assert.ok(streams.some((stream) => stream.codec_type === "audio"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
