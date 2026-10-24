/** Render each original caption template with FFmpeg to catch invalid ASS output. */
import { mkdtempSync, rmSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { generateAss, generateTimedCueAss } from "../lib/captions.ts";

const dir = mkdtempSync(path.join(tmpdir(), "klyp-captions-"));
try {
  for (const style of ["PULSE", "SLIDE", "SPARK", "BOUNCE", "GLOW", "COMIC", "KEYWORD"]) {
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
  const fontOutput = path.join(dir, "mono-cues.mp4");
  writeFileSync(path.join(dir, "mono-cues.ass"), generateTimedCueAss(
    [{ text: "Big moment", start_ms: 150, end_ms: 1000, id: "test" }],
    "BOUNCE", { color: "white", position: "bottom" }, { w: 360, h: 640 }, 0, "mono",
  ));
  const fontResult = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=360x640:r=24:d=2", "-vf", "ass=mono-cues.ass", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", fontOutput], { encoding: "utf8", cwd: dir });
  if (fontResult.status !== 0 || statSync(fontOutput).size < 1000) throw new Error(`font render failed: ${fontResult.stderr?.slice(-500)}`);
  console.log("mono-cues: rendered");
  const keywordOutput = path.join(dir, "keyword-cues.mp4");
  writeFileSync(path.join(dir, "keyword-cues.ass"), generateTimedCueAss(
    [{ text: "Been so fortunate", start_ms: 150, end_ms: 1500, id: "keyword" }],
    "KEYWORD", { color: "#FFFFFF", assColor: "&H00FFFFFF", anchorY: 0.95, alignment: 2 }, { w: 360, h: 640 },
  ));
  const keywordResult = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=360x640:r=24:d=2", "-vf", "ass=keyword-cues.ass", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", keywordOutput], { encoding: "utf8", cwd: dir });
  if (keywordResult.status !== 0 || statSync(keywordOutput).size < 1000) throw new Error(`keyword cue render failed: ${keywordResult.stderr?.slice(-500)}`);
  console.log("keyword-cues: rendered");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
