/** Render each original caption template with FFmpeg to catch invalid ASS output. */
import { mkdtempSync, rmSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { generateAss } from "../lib/captions.ts";

const dir = mkdtempSync(path.join(tmpdir(), "klyp-captions-"));
try {
  for (const style of ["PULSE", "SLIDE", "SPARK"]) {
    const subtitle = path.join(dir, `${style}.ass`);
    const output = path.join(dir, `${style}.mp4`);
    writeFileSync(subtitle, generateAss([
      { text: "Big", start: 150, end: 450 },
      { text: "moment", start: 470, end: 1000 },
    ], 0, 2000, style, { w: 360, h: 640 }));
    const result = spawnSync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
      "color=c=black:s=360x640:r=24:d=2",
      "-vf", `ass=${style}.ass`,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", output,
    ], { encoding: "utf8", cwd: dir });
    if (result.status !== 0 || statSync(output).size < 1000) {
      throw new Error(`${style} render failed: ${result.stderr?.slice(-500)}`);
    }
    console.log(`${style}: rendered`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
