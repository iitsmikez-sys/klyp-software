import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { expectedClipCeiling, upToClipsText } from "../lib/clip-expectation.ts";

test("short videos promise fewer clips, long ones keep the full ceiling", () => {
  assert.equal(expectedClipCeiling(10, 5 * 60), 1);
  assert.equal(expectedClipCeiling(10, 30 * 60), 3);
  assert.equal(expectedClipCeiling(10, 60 * 60), 6);
  assert.equal(expectedClipCeiling(10, 2 * 3600), 10);
  assert.equal(expectedClipCeiling(10, 8 * 3600), 10);
});

test("never above what was requested, never below 1, and unknown length keeps the request", () => {
  assert.equal(expectedClipCeiling(3, 8 * 3600), 3);
  assert.equal(expectedClipCeiling(10, 1), 1);
  assert.equal(expectedClipCeiling(10, null), 10);
  assert.equal(expectedClipCeiling(10, undefined), 10);
  assert.equal(expectedClipCeiling(10, NaN), 10);
  assert.equal(expectedClipCeiling(10, 0), 10);
  assert.equal(expectedClipCeiling(0, 600), 1);
});

test("wording is 'Up to N clips' and singular for one", () => {
  assert.equal(upToClipsText(10), "Up to 10 clips");
  assert.equal(upToClipsText(1), "Up to 1 clip");
});

test("the analyze screen never states a plain clip count", () => {
  const src = readFileSync(new URL("../components/AnalyzePanel.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, />\{clipCount\} clips ·/);
  assert.match(src, /upToClipsText\(shownClips\)/);
});
