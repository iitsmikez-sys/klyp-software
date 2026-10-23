import test from "node:test";
import assert from "node:assert/strict";
import { archivedClipTiming, clipSeekRange, updateClipTrim } from "../lib/clip-trim.ts";

test("archived media and preview account for a fractional saved start", () => {
  const timing = archivedClipTiming(100.75);
  assert.deepEqual(timing, { sourceStart: 100, previewLead: 0.75 });
  // A section beginning 1.25s into the saved clip starts 2s into its archive.
  assert.deepEqual(clipSeekRange(102, 107, timing.sourceStart, 130), { start: 2, end: 7 });
});

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

test("dragging either trim handle stays inside the original clip and leaves a playable range", () => {
  assert.deepEqual(updateClipTrim(100, 130, 105, 125, "start", 50), { start: 100, end: 125 });
  assert.deepEqual(updateClipTrim(100, 130, 105, 125, "start", 129), { start: 124.9, end: 125 });
  assert.deepEqual(updateClipTrim(100, 130, 105, 125, "end", 140), { start: 105, end: 130 });
  assert.deepEqual(updateClipTrim(100, 130, 105, 125, "end", 102), { start: 105, end: 105.1 });
});

test("timeline thumb positions can select a precise 25 second excerpt", () => {
  const first = updateClipTrim(100, 160, 100, 160, "start", 112.5);
  const second = updateClipTrim(100, 160, first.start, first.end, "end", 137.5);
  assert.deepEqual(second, { start: 112.5, end: 137.5 });
  assert.deepEqual(clipSeekRange(second.start, second.end, 100, 160), { start: 12.5, end: 37.5 });
});
