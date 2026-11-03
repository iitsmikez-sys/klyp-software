import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { nearestSnap, timelineSnapPoints, SNAP_PX } from "../lib/editor-timeline-snap.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");
const segments = [{ id: "s1", start_seconds: 10, end_seconds: 16 }, { id: "s2", start_seconds: 16, end_seconds: 40 }];
const inserts = [{ id: "i1", after_segment_id: "s1", start_ms: 6000, end_ms: 9000 }];
const cutaways = [{ start_ms: 12000, end_ms: 15000 }];

test("snap points are the ends, the playhead, every cut, insert and overlay edge", () => {
  const points = timelineSnapPoints({ segments, inserts, cutaways, duration: 33, outputTime: 20 });
  for (const expected of [0, 6, 9, 33, 20, 12, 15]) assert.ok(points.includes(expected), `missing ${expected}`);
});

test("an edge within 8 pixels clicks into the nearest point; farther away it stays put", () => {
  const points = [0, 6, 9, 20, 33];
  // 40 pixels per second: 8 pixels is 0.2 seconds.
  assert.deepEqual(nearestSnap(points, 6.15, 40), { value: 6, hit: true });
  assert.deepEqual(nearestSnap(points, 5.85, 40), { value: 6, hit: true });
  assert.deepEqual(nearestSnap(points, 6.4, 40), { value: 6.4, hit: false });
  assert.deepEqual(nearestSnap([6, 6.1], 6.08, 40), { value: 6.1, hit: true }, "the closest of two close points wins");
  assert.equal(SNAP_PX, 8);
  // Zoomed in (160 px per second) the same 8 pixels is only 0.05 seconds, so snapping is pickier.
  assert.equal(nearestSnap(points, 6.15, 160).hit, false);
});

test("the timeline has Fit all, zoom out, a slider up to 8x, zoom in, and a clearer split point", () => {
  const timeline = read("components/EditorTimeline.tsx");
  for (const label of ["Fit whole clip in view", "Zoom out", "Timeline zoom", "Zoom in"]) assert.ok(timeline.includes(`aria-label="${label}"`), label);
  assert.ok(timeline.includes("const MAX_ZOOM=8;"));
  assert.ok(timeline.includes("setSnapAt(") && timeline.includes("editor-snap-line"));
  assert.ok(timeline.includes("nearestSnap(timelineSnapPoints("));
  const css = read("components/clip-timeline-editor.css");
  assert.ok(css.includes(".editor-insert-target::after") && css.includes("border-radius:50%"));
  assert.ok(css.includes(".editor-zoom-controls") && css.includes(".editor-snap-line"));
});
