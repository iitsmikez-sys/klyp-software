import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildEditorMediaFilter } from "../lib/editor-media-render.ts";

test("FFmpeg joins source, photo, and imported video with continuous audio", () => {
  const dir = mkdtempSync(join(tmpdir(), "klyp-editor-import-"));
  try {
    const source = join(dir, "source.mp4");
    const photo = join(dir, "photo.jpg");
    const insert = join(dir, "insert.mp4");
    const output = join(dir, "output.mp4");
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=10:duration=4",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-c:v", "libx264", "-c:a", "aac", source]);
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=red:size=160x90",
      "-frames:v", "1", photo]);
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=90x160:rate=10:duration=2",
      "-f", "lavfi", "-i", "sine=frequency=880:duration=2", "-c:v", "libx264", "-c:a", "aac", insert]);
    const media = [
      { id: "11111111-1111-4111-8111-111111111111", kind: "image", after: 0, duration: 1 },
      { id: "22222222-2222-4222-8222-222222222222", kind: "video", after: 1, duration: 2 },
    ];
    const { graph, videoLabel, audioLabel } = buildEditorMediaFilter(
      [{ start: 0, end: 2 }, { start: 2, end: 4 }], media, true, [false, true], 160, 90,
    );
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", source,
      "-loop", "1", "-framerate", "30", "-t", "1", "-i", photo,
      "-i", insert, "-filter_complex", graph, "-map", videoLabel, "-map", audioLabel,
      "-c:v", "libx264", "-c:a", "aac", output]);
    const duration = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", output], { encoding: "utf8" }).trim());
    assert.ok(duration > 6.8 && duration < 7.2, `expected 7 seconds, got ${duration}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("FFmpeg overlays a photo without lengthening the source", () => {
  const media = [{ id: "11111111-1111-4111-8111-111111111111", kind: "image", after: 0,
    placement: "overlay", at: 1, duration: 2 }];
  const { graph, videoLabel, audioLabel } = buildEditorMediaFilter(
    [{ start: 0, end: 4 }], media, true, [false], 160, 90,
  );
  assert.match(graph, /overlay=/);
  const dir = mkdtempSync(join(tmpdir(), "klyp-editor-overlay-"));
  try {
    const source = join(dir, "source.mp4");
    const photo = join(dir, "photo.jpg");
    const output = join(dir, "output.mp4");
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:size=160x90:rate=10:duration=4",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-c:v", "libx264", "-c:a", "aac", source]);
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=red:size=160x90", "-frames:v", "1", photo]);
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", source, "-loop", "1", "-framerate", "30", "-t", "2", "-i", photo,
      "-filter_complex", graph, "-map", videoLabel, "-map", audioLabel, "-c:v", "libx264", "-c:a", "aac", output]);
    const duration = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", output], { encoding: "utf8" }).trim());
    assert.ok(duration > 3.8 && duration < 4.2, `expected 4 seconds, got ${duration}`);
    const pixel = (at) => {
      const bytes = execFileSync("ffmpeg", ["-loglevel", "error", "-ss", String(at), "-i", output,
        "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 160 * 90 * 4 });
      const center = (45 * 160 + 80) * 3;
      return [...bytes.subarray(center, center + 3)];
    };
    const before = pixel(0.5), during = pixel(1.5), after = pixel(3.5);
    assert.ok(before[2] > before[0] + 80, `expected blue source before photo: ${before}`);
    assert.ok(during[0] > during[2] + 80, `expected red photo over source: ${during}`);
    assert.ok(after[2] > after[0] + 80, `expected blue source after photo: ${after}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("photo overlay remains visible over an imported video", () => {
  const dir = mkdtempSync(join(tmpdir(), "klyp-editor-over-video-"));
  try {
    const source = join(dir, "source.mp4"), insert = join(dir, "insert.mp4");
    const photo = join(dir, "photo.jpg"), output = join(dir, "output.mp4");
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:size=160x90:rate=10:duration=4", "-c:v", "libx264", source]);
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=green:size=160x90:rate=10:duration=2", "-c:v", "libx264", insert]);
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=red:size=160x90", "-frames:v", "1", photo]);
    const media = [
      { id: "22222222-2222-4222-8222-222222222222", kind: "video", after: 0, duration: 2 },
      { id: "11111111-1111-4111-8111-111111111111", kind: "image", after: 0,
        placement: "overlay", at: 2.5, duration: 1 },
    ];
    const { graph, videoLabel, audioLabel } = buildEditorMediaFilter(
      [{ start: 0, end: 2 }, { start: 2, end: 4 }], media, false, [false, false], 160, 90,
    );
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", source, "-i", insert,
      "-loop", "1", "-framerate", "30", "-t", "1", "-i", photo,
      "-filter_complex", graph, "-map", videoLabel, "-map", audioLabel,
      "-c:v", "libx264", "-c:a", "aac", output]);
    const pixel = (at) => {
      const bytes = execFileSync("ffmpeg", ["-loglevel", "error", "-ss", String(at), "-i", output,
        "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 160 * 90 * 4 });
      const center = (45 * 160 + 80) * 3;
      return [...bytes.subarray(center, center + 3)];
    };
    const during = pixel(2.8), after = pixel(3.8);
    assert.ok(during[0] > during[1] + 80, `photo should cover inserted video: ${during}`);
    assert.ok(after[1] > after[0] + 35, `inserted video should resume: ${after}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
