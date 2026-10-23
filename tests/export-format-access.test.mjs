import test from "node:test";
import assert from "node:assert/strict";
import * as clips from "../lib/clips.ts";

test("Free can export vertical and uncropped Original", () => {
  assert.equal(clips.canUseExportFormat?.("9:16", false), true);
  assert.equal(clips.canUseExportFormat?.("Original", false), true);
  assert.equal(clips.resolveExportFormat?.("Original", false), "Original");
});

test("Free square and wide requests resolve to vertical exports", () => {
  for (const format of ["1:1", "16:9"]) {
    assert.equal(clips.canUseExportFormat?.(format, false), false);
    assert.equal(clips.resolveExportFormat?.(format, false), "9:16");
  }
});

test("Pro retains every export format", () => {
  for (const format of clips.EXPORT_FORMATS) {
    assert.equal(clips.canUseExportFormat?.(format, true), true);
    assert.equal(clips.resolveExportFormat?.(format, true), format);
  }
});
