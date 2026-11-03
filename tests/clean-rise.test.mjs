import test from "node:test";
import assert from "node:assert/strict";
import { captionMotion, captionAssMotion, captionAssMotionAt, CLEAN_RISE_MS, CLEAN_RISE_PX } from "../lib/caption-template-motion.ts";
import { generateAss, generateTimedCueAss, captionAppearance } from "../lib/captions.ts";

const bs = String.fromCharCode(92);
const words = [["the", 0], ["story", 300], ["starts", 600], ["here", 900]].map(([text, start]) => ({ text, start, end: start + 280 }));
const res = { w: 1080, h: 1920 };
const lines = (ass) => ass.split("\n").filter((l) => l.startsWith("Dialogue:"));

test("Clean fades in while drifting up 28px over 350ms, without resizing", () => {
  assert.equal(CLEAN_RISE_PX, 28);
  assert.equal(CLEAN_RISE_MS, 350);
  assert.deepEqual([captionMotion("CLEAN", 0).alpha, captionMotion("CLEAN", 0).yOffset], [0, 28]);
  assert.ok(Math.abs(captionMotion("CLEAN", 175).alpha - 0.5) < 1e-9);
  assert.ok(Math.abs(captionMotion("CLEAN", 175).yOffset - 14) < 1e-9);
  assert.deepEqual([captionMotion("CLEAN", 350).alpha, captionMotion("CLEAN", 350).yOffset], [1, 0]);
  assert.equal(captionMotion("CLEAN", 2000).yOffset, 0);
  assert.equal(captionMotion("CLEAN", 100).scale, 1);
});

test("the export moves each Clean caption up into place, like the preview", () => {
  // Bottom captions sit 80px up: y 1840, so the move runs from 1868 to 1840.
  assert.equal(captionAssMotion("CLEAN", 1080, 1920, "BOTTOM"), `{${bs}move(540,1868,540,1840,0,350)${bs}fad(350,0)}`);
  assert.ok(lines(generateAss(words, 0, 1500, "CLEAN", res)).every((l) => l.includes(`${bs}move(540,1868,540,1840,0,350)${bs}fad(350,0)`)));
  const editor = generateTimedCueAss([{ id: "a", start_ms: 0, end_ms: 1200, text: "the story starts here" }], "CLEAN",
    captionAppearance({ caption_color: "white", caption_position: "bottom" }), res);
  assert.ok(lines(editor).every((l) => l.includes(`${bs}move(`) && l.includes(`${bs}fad(350,0)`)));
  assert.equal(captionAssMotionAt("CLEAN", 540, 1600, 1920), `{${bs}an5${bs}move(540,1628,540,1600,0,350)${bs}fad(350,0)}`);
});

test("the rise ends where the caption sits when the video leaves room at the bottom", () => {
  const withInset = lines(generateAss(words, 0, 1500, "CLEAN", res, 700, true));
  assert.ok(withInset[0].includes(`${bs}move(540,1168,540,1140,0,350)`), withInset[0]);
  // The same fix applies to Slide, which used to ignore the inset.
  assert.ok(captionAssMotion("SLIDE", 1080, 1920, "BOTTOM", 700).includes("540,1140,0,220"));
});

test("other captions are unchanged", () => {
  assert.equal(captionAssMotion("BOLD", 1080, 1920, "BOTTOM"), "");
  assert.equal(captionMotion("BOLD", 0).alpha, 1);
  assert.equal(captionAssMotion("SLIDE", 1080, 1920, "BOTTOM"), `{${bs}move(540,1895,540,1840,0,220)${bs}fad(180,0)}`);
});
