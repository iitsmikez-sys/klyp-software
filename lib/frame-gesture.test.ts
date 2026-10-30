import assert from "node:assert/strict";
import test from "node:test";
import { dragFrame, zoomFrame } from "./frame-gesture.ts";

const full = { version: 1 as const, gameplay: { x: 0, y: 0, w: 1, h: 1 }, fit: { zoom: 1, x: 0, y: 0 } };
const stacked = { version: 1 as const, gameplay: { x: .2, y: .1, w: .5, h: .6 }, facecam: { x: .05, y: .05, w: .25, h: .3 }, arrangement: 'facecam_top' as const };

test('dragging the full stream moves its placement inside the vertical frame', () => {
  assert.deepEqual(dragFrame(full, 'full', .1, -.2).fit, { zoom: 1, x: .1, y: -.2 });
});

test('dragging a stacked panel moves only its source crop', () => {
  const moved = dragFrame(stacked, 'facecam', .2, 0);
  assert.ok(moved.facecam!.x < stacked.facecam.x);
  assert.deepEqual(moved.gameplay, stacked.gameplay);
});

test('pinching a stacked panel enlarges its content without changing the other panel', () => {
  const next = zoomFrame(stacked, 'gameplay', 2);
  assert.ok(next.gameplay.w < stacked.gameplay.w);
  assert.deepEqual(next.facecam, stacked.facecam);
});

test('full stream zoom stays within safe bounds', () => {
  assert.equal(zoomFrame(full, 'full', 10).fit?.zoom, 4);
  assert.equal(zoomFrame(full, 'full', .1).fit?.zoom, 1);
});
