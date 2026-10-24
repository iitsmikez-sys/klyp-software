import assert from "node:assert/strict";
import test from "node:test";
import { unseenVods } from "../lib/vod-discovery.ts";

const videos = [
  { id: "103", created_at: "2026-10-23T03:00:00Z" },
  { id: "102", created_at: "2026-10-23T02:00:00Z" },
  { id: "101", created_at: "2026-10-23T01:00:00Z" },
];

test("discovery queues every new VOD oldest first between sweeps", () => {
  assert.deepEqual(unseenVods(videos, "100", "2026-10-22T00:00:00Z").map((v) => v.id), ["101", "102", "103"]);
  assert.deepEqual(unseenVods(videos, "102", "2026-10-22T00:00:00Z").map((v) => v.id), ["103"]);
});

test("first connection skips old VODs but includes those published afterward", () => {
  assert.deepEqual(unseenVods(videos, null, "2026-10-23T01:30:00Z").map((v) => v.id), ["102", "103"]);
  assert.deepEqual(unseenVods(videos, null, "2026-10-23T04:00:00Z"), []);
});
