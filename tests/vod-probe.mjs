import test from "node:test";
import assert from "node:assert/strict";
import { parseVodProbe } from "../lib/vod-probe.ts";

test("reads duration and display metadata from one existing yt-dlp probe", () => {
  assert.deepEqual(parseVodProbe('8100\n"  An evening of Just Chatting  "\n"https://example.com/thumb.jpg"'), {
    durationSeconds: 8100,
    title: "An evening of Just Chatting",
    thumbnail: "https://example.com/thumb.jpg",
  });
});

test("keeps valid duration when optional metadata is absent or unsafe", () => {
  assert.deepEqual(parseVodProbe('120\n"NA"\n"javascript:alert(1)"'), {
    durationSeconds: 120,
    title: null,
    thumbnail: null,
  });
});

test("rejects a source with no usable duration", () => {
  assert.throws(() => parseVodProbe('null\n"Untitled"\n"NA"'), /No duration/);
});
