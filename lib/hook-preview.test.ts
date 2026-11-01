import assert from "node:assert/strict";
import test from "node:test";
import { generateHookAss, HOOK_STYLES } from "./captions.ts";
import { drawHookPreview } from "./hook-preview.ts";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

test("hook stays inside a 260px top safe margin in both export and preview", () => {
  const ass = generateHookAss("A MOMENT", { w: 1080, h: 1920 }, "CLASSIC");
  assert.match(ass, /,8,40,40,260,1/);
  const positions: number[] = [];
  const ctx = {
    save() {}, restore() {}, measureText: (text: string) => ({ width: text.length * 12 }),
    strokeText(_text: string, _x: number, y: number) { positions.push(y); },
    fillText(_text: string, _x: number, y: number) { positions.push(y); },
  } as unknown as CanvasRenderingContext2D;
  drawHookPreview(ctx, 0, "A MOMENT", "CLASSIC", 540, 960);
  assert.ok(positions.length > 0);
  assert.ok(positions.every(y => y === 130));
});

test("white box hook uses black uppercase text on a white background in preview and export", () => {
  assert.ok((HOOK_STYLES as readonly string[]).includes("WHITE_BOX"));
  const ass = generateHookAss("Front cut", { w: 1080, h: 1920 }, "WHITE_BOX");
  assert.match(ass, /Style: Hook,Arial Black,62,&H00000000,&H00000000,&H00FFFFFF,&H00000000,1,0,0,0,100,100,0,0,3,14,0,8,/);
  assert.match(ass, /FRONT CUT/);
  const colors: string[] = [];
  const ctx = {
    fillStyle: "",
    save() {}, restore() {}, measureText: (text: string) => ({ width: text.length * 20 }),
    fillRect(this: { fillStyle: string }) { colors.push(this.fillStyle); },
    fillText(this: { fillStyle: string }, text: string) { assert.equal(text, "FRONT CUT"); colors.push(this.fillStyle); },
  } as unknown as CanvasRenderingContext2D;
  drawHookPreview(ctx, 0, "Front cut", "WHITE_BOX", 1080, 1920);
  assert.deepEqual(colors, ["#ffffff", "#000000"]);
});

test("FFmpeg renders the white hook card with dark lettering", t => {
  if (spawnSync("ffmpeg", ["-version"]).error) { t.skip("FFmpeg unavailable"); return; }
  const directory = mkdtempSync(path.join(tmpdir(), "klyp-white-hook-"));
  try {
    const ass = generateHookAss("THE FRONT IS THE RISKIEST PART TO CUT", { w: 540, h: 960 }, "WHITE_BOX");
    assert.match(ass, /\\N/, "long hooks break into compact lines");
    writeFileSync(path.join(directory, "overlay.ass"), ass);
    const result = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=0x404040:s=540x960:r=1:d=1", "-vf", "subtitles=overlay.ass", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { cwd: directory, maxBuffer: 2_000_000 });
    assert.equal(result.status, 0, result.stderr.toString());
    let white = 0, black = 0;
    for (let y = 100; y < 280; y++) for (let x = 70; x < 470; x++) {
      const at = (y * 540 + x) * 3;
      const [red, green, blue] = result.stdout.subarray(at, at + 3);
      if (red > 225 && green > 225 && blue > 225) white++;
      if (red < 25 && green < 25 && blue < 25) black++;
    }
    assert.ok(white > 1000, `expected visible white card, got ${white} white pixels`);
    assert.ok(black > 100, `expected dark letters on the card, got ${black} dark pixels`);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
