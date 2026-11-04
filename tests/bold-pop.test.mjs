import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { captionMotion, captionAssMotion, captionAssMotionAt, BOLD_POP } from "../lib/caption-template-motion.ts";
import { generateAss } from "../lib/captions.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

test("Bold pops in like CapCut's default: 85% to 106% in 100ms, then settles to full size by 200ms", () => {
  near(captionMotion("BOLD", 0).scale, 0.85, "start");
  near(captionMotion("BOLD", 50).scale, 0.955, "halfway up");
  near(captionMotion("BOLD", 100).scale, 1.06, "peak");
  near(captionMotion("BOLD", 150).scale, 1.03, "settling");
  near(captionMotion("BOLD", 200).scale, 1, "done");
  near(captionMotion("BOLD", 5000).scale, 1, "stays at full size");
  assert.equal(captionMotion("BOLD", 0).yOffset, 0);
});

test("Bold fades in during the first 60ms and then stays fully visible", () => {
  near(captionMotion("BOLD", 0).alpha, 0, "start");
  near(captionMotion("BOLD", 30).alpha, 0.5, "halfway");
  assert.equal(captionMotion("BOLD", 60).alpha, 1);
  assert.equal(captionMotion("BOLD", 3000).alpha, 1);
  assert.equal(captionMotion("BOLD", -50).alpha, 0);
});

test("the exported motion uses the same numbers as the live preview", () => {
  const bs = String.fromCharCode(92);
  assert.equal(captionAssMotion("BOLD", 1080, 1920, "BOTTOM"),
    `{${bs}fscx85${bs}fscy85${bs}t(0,100,${bs}fscx106${bs}fscy106)${bs}t(100,200,${bs}fscx100${bs}fscy100)${bs}fad(60,0)}`);
  assert.equal(BOLD_POP.fromScale * 100, 85);
  assert.equal(BOLD_POP.peakScale * 100, 106);
  assert.equal(BOLD_POP.riseMs + BOLD_POP.settleMs, 200);
  assert.equal(BOLD_POP.fadeMs, 60);
  // Captions placed inside an editor layout pop in too, anchored where they were.
  assert.ok(captionAssMotionAt("BOLD", 540, 1700, 1920).startsWith(`{${bs}an5${bs}pos(540,1700)${bs}fscx85`));
});

test("every Bold caption phrase in an exported clip starts with the pop, and other styles keep their own motion", () => {
  const words = ["this", "team", "is", "so", "bad", "honestly", "no", "way", "we", "lost"].map((text, i) => ({ text, start: i * 400, end: i * 400 + 350 }));
  const lines = (style) => generateAss(words, 0, 5000, style).split("\n").filter((l) => l.startsWith("Dialogue:"));
  const bold = lines("BOLD");
  assert.ok(bold.length >= 2);
  for (const line of bold) assert.match(line, /,,0,0,0,,\{\\fscx85\\fscy85\\t\(0,100,\\fscx106\\fscy106\)\\t\(100,200,\\fscx100\\fscy100\)\\fad\(60,0\)\}/);
  for (const line of lines("KLYP")) assert.doesNotMatch(line, /\\fscx85/);
});

test("the live preview animates Bold through the shared motion function", () => {
  assert.match(read("lib/caption-preview.ts"), /captionMotion\(style,/);
  assert.match(read("components/VerticalLayoutPreview.tsx"), /captionMotion\(style,/);
});
