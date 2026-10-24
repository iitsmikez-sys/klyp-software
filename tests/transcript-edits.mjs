import test from "node:test";
import assert from "node:assert/strict";
import { removeTranscriptRange, findQuietPauses } from "../lib/transcript-edits.ts";

test("removing selected words ripples source sections, captions, and imported media", () => {
  const media = [{ id: "a", kind: "image", duration: 3, after: 0 },
    { id: "b", kind: "image", duration: 2, after: 0, placement: "overlay", at: 45 }];
  const result = removeTranscriptRange([{ start: 0, end: 60 }], media, 20, 25);
  assert.deepEqual(result.segments, [{ start: 0, end: 20 }, { start: 25, end: 60 }]);
  assert.equal(result.media[0].after, 1);
  assert.equal(result.media[1].at, 40);
});

test("a transcript cut cannot erase the entire clip or create sub-frame slivers", () => {
  assert.equal(removeTranscriptRange([{ start: 0, end: 10 }], [], 0, 10), null);
  assert.deepEqual(removeTranscriptRange([{ start: 0, end: 10 }], [], 0.05, 5)?.segments,
    [{ start: 5, end: 10 }]);
});

test("quiet-pause suggestions require both a speech gap and low waveform energy", () => {
  const words = [
    { text: "Hi", start: 0, end: 500 },
    { text: "there", start: 3200, end: 3500 },
    { text: "now", start: 6500, end: 6800 },
  ];
  const peaks = Array(100).fill(0.01);
  peaks.fill(0.8, 55, 80);
  const pauses = findQuietPauses(words, 0, [{ start: 0, end: 7 }], peaks, 7);
  assert.equal(pauses.length, 1);
  assert.ok(pauses[0].start >= 0.5 && pauses[0].end <= 3.2);
  assert.deepEqual(findQuietPauses(words, 0, [{ start: 0, end: 7 }], [], 7), []);
});
