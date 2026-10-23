import test from "node:test";
import assert from "node:assert/strict";
import * as timeline from "./editor-timeline.ts";
const segments = [{ id: "a", start_seconds: 100, end_seconds: 110 }, { id: "b", start_seconds: 120, end_seconds: 130 }];
test("split preserves duration and immutable source order", () => {
  const split = timeline.splitSegment(segments, "a", 105);
  assert.equal(split.length, 3);
  assert.equal(new Set(split.map(s => s.id)).size, 3);
  assert.equal(timeline.outputDuration(split), 20);
  assert.equal(segments.length, 2);
});
test("delete ripples output and boundary maps to next kept source", () => {
  assert.equal(timeline.sourceAtOutputTime(segments, 10), 120);
  assert.equal(timeline.sourceAtOutputTime(segments, 20), 130);
  assert.equal(timeline.sourceAtOutputTime(timeline.deleteSegment(segments, "a"), 0), 120);
  assert.throws(() => timeline.deleteSegment([segments[0]], "a"));
});
test("trim changes only selected segment and rejects overlap and short pieces", () => {
  assert.deepEqual(timeline.trimSegment(segments, "a", 102, 109), [{ ...segments[0], start_seconds: 102, end_seconds: 109 }, segments[1]]);
  assert.throws(() => timeline.trimSegment(segments, "a", 102, 121));
  assert.throws(() => timeline.splitSegment(segments, "a", 100.01));
  assert.throws(() => timeline.trimSegment(segments, "missing", 100, 101));
});
test("source cues fragment across cuts in output milliseconds", () => {
  assert.deepEqual(timeline.outputSpansForSourceCue(segments, { start_ms: 108000, end_ms: 122000 }), [{ start_ms: 8000, end_ms: 10000 }, { start_ms: 10000, end_ms: 12000 }]);
  assert.deepEqual(timeline.outputSpansForSourceCue(segments, { start_ms: 111000, end_ms: 119000 }), []);
});

test("split generates a unique bounded ID from a maximum-length source ID", () => {
  const id = "x".repeat(120);
  const collision = `${"x".repeat(112)}-split-1`;
  const source = [{ id, start_seconds: 100, end_seconds: 110 }, { id: collision, start_seconds: 120, end_seconds: 130 }];
  const result = timeline.splitSegment(source, id, 105);
  assert.equal(result[0].id, id);
  assert.ok(result.every(s => s.id.length <= 120));
  assert.equal(new Set(result.map(s => s.id)).size, 3);
  assert.equal(timeline.outputDuration(result), 20);
});
