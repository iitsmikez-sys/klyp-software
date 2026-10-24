import assert from "node:assert/strict";
import test from "node:test";
import { withinClipWindow, acquireUserProcessingSlot } from "../lib/clip-access-core.ts";

test("a user may shorten an owned clip but cannot extend or swap its source", () => {
  const allowed = { source_key: "twitch:123", start_seconds: 30, end_seconds: 90 };
  assert.equal(withinClipWindow({ source_key: allowed.source_key, start_seconds: 40, end_seconds: 70 }, allowed), true);
  assert.equal(withinClipWindow({ source_key: allowed.source_key, start_seconds: 20, end_seconds: 70 }, allowed), false);
  assert.equal(withinClipWindow({ source_key: "twitch:456", start_seconds: 40, end_seconds: 70 }, allowed), false);
});

test("one account cannot fill the entire processing queue", () => {
  const releases = Array.from({ length: 3 }, () => acquireUserProcessingSlot("user-1"));
  assert.ok(releases.every(Boolean));
  assert.equal(acquireUserProcessingSlot("user-1"), null);
  assert.ok(acquireUserProcessingSlot("user-2"));
  releases[0](); releases[0]();
  assert.ok(acquireUserProcessingSlot("user-1"));
  releases.slice(1).forEach((release) => release());
});
