import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { clampInsertDuration, insertDurationLimits, resizeInsert, INSERT_MIN_MS, INSERT_MAX_MS } from "../lib/editor-media-client.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");
const segments = (seconds) => [{ id: "s1", start_seconds: 0, end_seconds: seconds }, { id: "s2", start_seconds: seconds, end_seconds: seconds + 10 }];
const insert = (ms = 3000, asset_in_ms = 0) => ({ id: "i1", asset_id: "a1", after_segment_id: "s1", duration_ms: ms, asset_in_ms, muted: false });
const draftOf = (seconds, ins) => ({ segments: segments(seconds), inserts: [ins], cutaways: [] });
const photo = { id: "a1", kind: "photo", status: "verified", duration_ms: null };
const video = (ms) => ({ id: "a1", kind: "video", status: "verified", duration_ms: ms });

test("a photo can be anywhere from 0.1 to 60 seconds, within the 3-minute clip", () => {
  const draft = draftOf(20, insert());
  assert.deepEqual(insertDurationLimits(draft, draft.inserts[0], photo), { min: INSERT_MIN_MS, max: 60000 });
  assert.equal(clampInsertDuration(draft, draft.inserts[0], photo, 8000), 8000);
  assert.equal(clampInsertDuration(draft, draft.inserts[0], photo, 5), INSERT_MIN_MS);
  assert.equal(clampInsertDuration(draft, draft.inserts[0], photo, 999999), INSERT_MAX_MS);
});

test("the whole clip stays under 3 minutes: the room left caps the length", () => {
  // 150s of video + 20s of video = 170s, plus the 3s insert = 173s; 7s of room remain, so the insert can reach 10s.
  const draft = { segments: [{ id: "s1", start_seconds: 0, end_seconds: 150 }, { id: "s2", start_seconds: 150, end_seconds: 170 }], inserts: [insert(3000)], cutaways: [] };
  assert.equal(insertDurationLimits(draft, draft.inserts[0], photo).max, 10000);
  assert.equal(clampInsertDuration(draft, draft.inserts[0], photo, 30000), 10000);
});

test("an inserted video cannot run past the end of the imported file", () => {
  const draft = draftOf(20, insert(4000, 2000));
  assert.equal(insertDurationLimits(draft, draft.inserts[0], video(9000)).max, 7000);
  assert.equal(clampInsertDuration(draft, draft.inserts[0], video(9000), 20000), 7000);
});

test("resizing changes only that inserted section and returns the same draft when nothing changes", () => {
  const draft = { ...draftOf(20, insert()), inserts: [insert(), { ...insert(2000), id: "i2" }] };
  const longer = resizeInsert(draft, "i1", photo, 6000);
  assert.deepEqual(longer.inserts.map((i) => i.duration_ms), [6000, 2000]);
  assert.equal(draft.inserts[0].duration_ms, 3000, "the original draft is not mutated");
  assert.equal(resizeInsert(draft, "i1", photo, 3000), draft);
  assert.equal(resizeInsert(draft, "missing", photo, 6000), draft);
});

test("the timeline shows drag handles on a selected insert or overlay, and the panel has a Length box", () => {
  const timeline = read("components/EditorTimeline.tsx");
  assert.ok(timeline.includes("Change length of inserted media") && timeline.includes("Change start of imported media") && timeline.includes("Change end of imported media"));
  assert.ok(timeline.includes("startResize(e,'insert'") && timeline.includes("startResize(e,'cutaway'"));
  const editor = read("components/ClipTimelineEditor.tsx");
  assert.ok(editor.includes("<EditorInsertLength") && editor.includes("onResizeInsert={resizeInsertMs}") && editor.includes("onResizeCutaway={resizeCutawayMs}"));
  assert.ok(read("components/clip-timeline-editor.css").includes(".editor-resize-handle"));
});
