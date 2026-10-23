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
