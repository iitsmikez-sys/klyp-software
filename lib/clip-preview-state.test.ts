import assert from "node:assert/strict";
import test from "node:test";
import { clipPreviewPlayback, clipPreviewActionBlocked } from "./clip-preview-state.ts";

test("saved trim bounds playback even when editor details are closed", () => {
  assert.deepEqual(clipPreviewPlayback(1, 5, 12), { time: 5, pause: false });
  assert.deepEqual(clipPreviewPlayback(8, 5, 12), { time: 8, pause: false });
  assert.deepEqual(clipPreviewPlayback(12, 5, 12), { time: 5, pause: true });
});

test("unsaved edits block cached export and retry regardless of panel state", () => {
  assert.equal(clipPreviewActionBlocked(true), true);
  assert.equal(clipPreviewActionBlocked(false), false);
});
