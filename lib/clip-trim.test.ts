import test from "node:test";
import assert from "node:assert/strict";
import { clipSeekRange } from "./clip-trim.ts";

test("full archived clip starts at zero and ends at its duration", () => {
  assert.deepEqual(clipSeekRange(100, 130, 100, 130), { start: 0, end: 30 });
});

test("middle trim seeks relative to archived master's original start", () => {
  assert.deepEqual(clipSeekRange(107, 122, 100, 130), { start: 7, end: 22 });
});

test("trim ending at exact original end retains the last frame range", () => {
  assert.deepEqual(clipSeekRange(125, 130, 100, 130), { start: 25, end: 30 });
});

test("source VOD segment offset can precede selected trim", () => {
  assert.deepEqual(clipSeekRange(107, 122, 105), { start: 2, end: 17 });
});

test("archive trim outside original bounds fails", () => {
  assert.throws(() => clipSeekRange(99, 120, 100, 130));
  assert.throws(() => clipSeekRange(110, 131, 100, 130));
  assert.throws(() => clipSeekRange(110, 110, 100, 130));
});
