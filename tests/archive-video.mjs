import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { archiveScaleFilter } from "../lib/archive-video.ts";

test("archive filter encodes a source whose aspect ratio rounds to odd width", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "klyp-archive-scale-"));
  try {
    const output = path.join(dir, "master.mp4");
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi",
      "-i", "color=c=black:s=852x480:r=10:d=1", "-vf", archiveScaleFilter(1080),
      "-c:v", "libx264", "-threads", "2", "-y", output]);
    assert.ok(statSync(output).size > 1000);
    const dimensions = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=width,height", "-of", "csv=p=0", output], { encoding: "utf8" }).trim();
    const [width, height] = dimensions.split(",").map(Number);
    assert.equal(width % 2, 0);
    assert.equal(height % 2, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
