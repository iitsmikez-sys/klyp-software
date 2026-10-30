import assert from "node:assert/strict";
import test from "node:test";
import { generateHookAss } from "./captions.ts";
import { drawHookPreview } from "./hook-preview.ts";

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
