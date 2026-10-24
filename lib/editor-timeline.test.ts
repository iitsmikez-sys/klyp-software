import test from "node:test";
import assert from "node:assert/strict";
import * as timeline from "./editor-timeline.ts";
import type { ClipEditDraftV3 } from "./clip-edit-draft.ts";
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

function visualDraft(kept = [{ id: "whole", start_seconds: 100, end_seconds: 130 }]): ClipEditDraftV3 {
 return { version: 3, start_seconds: kept[0].start_seconds, end_seconds: kept.at(-1)!.end_seconds,
 title: "clip", hook: "", hook_style: "IMPACT", caption_style: "BOLD", aspect_ratio: "9:16", words: null,
 segments: kept, caption_cues: null, caption_color: "white", caption_position: "bottom",
 cutaways: [{ id: "photo", asset_id: "asset", source_start_ms: 110000, source_end_ms: 113000, asset_in_ms: 500, fit: "cover", focal_point: { x: 0.5, y: 0.5 } }] };
}
test("three-second photo resolves on output time with stable identity and crop", () => {
 const spans = timeline.resolveCutawaySpans(visualDraft());
 assert.deepEqual(spans, [{ ...visualDraft().cutaways[0], start_ms: 10000, end_ms: 13000 }]);
});
test("removing five seconds before an insert moves it five seconds earlier", () => {
 const spans = timeline.resolveCutawaySpans(visualDraft([{ id: "kept", start_seconds: 105, end_seconds: 130 }]));
 assert.equal(spans[0].start_ms, 5000);
 assert.equal(spans[0].end_ms, 8000);
 assert.equal(spans[0].asset_in_ms, 500);
});
test("cuts through a covered moment shorten output and skip matching imported footage", () => {
 const draft = visualDraft([{ id: "a", start_seconds: 100, end_seconds: 111 }, { id: "b", start_seconds: 112, end_seconds: 130 }]);
 assert.deepEqual(timeline.resolveCutawaySpans(draft).map(s => [s.start_ms, s.end_ms, s.asset_in_ms]), [[10000, 11000, 500], [11000, 12000, 2500]]);
 assert.equal(draft.cutaways[0].asset_in_ms, 500);
});
test("deleting all covered moments removes the resolved cutaway", () => {
 assert.deepEqual(timeline.resolveCutawaySpans(visualDraft([{ id: "a", start_seconds: 100, end_seconds: 110 }, { id: "b", start_seconds: 113, end_seconds: 130 }])), []);
});
test("cutaway lookup chooses the next half-open interval at boundaries", () => {
 const spans = timeline.resolveCutawaySpans(visualDraft([{ id: "a", start_seconds: 100, end_seconds: 111 }, { id: "b", start_seconds: 112, end_seconds: 130 }]));
 assert.equal(timeline.cutawayAtOutputTime(spans, 10), spans[0]);
 assert.equal(timeline.cutawayAtOutputTime(spans, 11), spans[1]);
 for (const time of [-1, 9.999, 12, NaN, Infinity]) assert.equal(timeline.cutawayAtOutputTime(spans, time), null);
});
test("resolved spans sort by output time even when cutaways were inserted out of order", () => {
 const draft = visualDraft();
 draft.cutaways.unshift({ ...draft.cutaways[0], id: "earlier", source_start_ms: 105000, source_end_ms: 108000 });
 draft.cutaways.reverse();
 assert.deepEqual(timeline.resolveCutawaySpans(draft).map(s => s.id), ["earlier", "photo"]);
});
