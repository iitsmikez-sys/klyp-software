import assert from "node:assert/strict";
import test from "node:test";
import { generateHookAss, HOOK_STYLES, whiteBoxCardGeometry, wrapCaptionText } from "./captions.ts";
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

test("white box hook draws one rounded card behind every line", () => {
  assert.ok((HOOK_STYLES as readonly string[]).includes("WHITE_BOX"));
  const ass = generateHookAss("Front cut", { w: 1080, h: 1920 }, "WHITE_BOX");
  assert.match(ass, /\\p1/);
  assert.match(ass, /FRONT CUT/);
  const colors: string[] = [];
  let cards = 0;
  const ctx = {
    fillStyle: "",
    save() {}, restore() {}, measureText: (text: string) => ({ width: text.length * 20 }),
    beginPath() {}, roundRect() { cards++; }, fill(this: { fillStyle: string }) { colors.push(this.fillStyle); },
    fillText(this: { fillStyle: string }, _text: string) { colors.push(this.fillStyle); },
  } as unknown as CanvasRenderingContext2D;
  drawHookPreview(ctx, 0, "THE FRONT IS THE RISKIEST PART TO CUT", "WHITE_BOX", 1080, 1920);
  assert.equal(cards, 1);
  assert.equal(colors[0], "#ffffff");
  assert.ok(colors.slice(1).length > 1);
  assert.ok(colors.slice(1).every(color => color === "#000000"));
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
    const lines = wrapCaptionText("THE FRONT IS THE RISKIEST PART TO CUT", "BOLD", 18);
    const card = whiteBoxCardGeometry(lines, 31, Math.round(31 * 1.25), 270, 130, { w: 540, h: 960 });
    const pixel = (x: number, y: number) => [...result.stdout.subarray((y * 540 + x) * 3, (y * 540 + x) * 3 + 3)];
    for (const y of [card.y + card.radius + 2, card.y + Math.floor(card.height / 2), card.y + card.height - card.radius - 3]) {
      assert.ok(pixel(card.x + 3, y).every(channel => channel > 225), `card should keep a straight left edge at y=${y}`);
    }
    assert.ok(pixel(card.x, card.y).every(channel => channel < 100), "card should have a rounded corner");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
