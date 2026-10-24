import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateAss } from "../lib/captions.ts";
import { captionMotion } from "../lib/caption-template-motion.ts";

const words = [{ text: "Big", start: 100, end: 340 }, { text: "moment", start: 350, end: 700 }];

test("three original animated templates are selectable and have ASS motion", () => {
  const catalog = readFileSync(new URL("../lib/clips.ts", import.meta.url), "utf8");
  for (const style of ["PULSE", "SLIDE", "SPARK"]) {
    assert.match(catalog, new RegExp(`"${style}"`));
    const ass = generateAss(words, 0, 2000, style, { w: 1080, h: 1920 });
    assert.match(ass, /Dialogue:/);
    assert.match(ass, /\\(?:t|move)\(/);
  }
});

test("preview motion reaches the same final placement as export", () => {
  assert.deepEqual(captionMotion("PULSE", 0), { scale: 0.72, yOffset: 0, alpha: 0 });
  assert.deepEqual(captionMotion("PULSE", 250), { scale: 1, yOffset: 0, alpha: 1 });
  assert.deepEqual(captionMotion("SLIDE", 0), { scale: 1, yOffset: 55, alpha: 0 });
  assert.deepEqual(captionMotion("SLIDE", 250), { scale: 1, yOffset: 0, alpha: 1 });
});
