import test from "node:test";
import assert from "node:assert/strict";
import {
  buildEditorTimeline, parseMediaInserts, mediaAfterSplit, mediaAfterDelete, editorMediaPath,
  retimeWordsWithMedia, timelineItemAt, outputTimeForSource,
} from "../lib/editor-media.ts";

const photo = { id: "11111111-1111-4111-8111-111111111111", kind: "image", after: 0, duration: 3 };
const video = { id: "22222222-2222-4222-8222-222222222222", kind: "video", after: 1, duration: 4 };
const sections = [{ start: 0, end: 10 }, { start: 20, end: 30 }];

test("imported media takes an explicit position between kept source sections", () => {
  const items = buildEditorTimeline(sections, [photo, video]);
  assert.deepEqual(items.map(({ kind, start, end }) => ({ kind, start, end })), [
    { kind: "source", start: 0, end: 10 },
    { kind: "image", start: 10, end: 13 },
    { kind: "source", start: 13, end: 23 },
    { kind: "video", start: 23, end: 27 },
  ]);
  assert.equal(timelineItemAt(items, 10)?.kind, "image");
  assert.equal(timelineItemAt(items, 13)?.kind, "source");
  assert.equal(outputTimeForSource(items, 20), 13);
  const adjacent = buildEditorTimeline([{ start: 0, end: 10 }, { start: 10, end: 20 }], [photo]);
  assert.equal(outputTimeForSource(adjacent, 10), 13);
});

test("captions move after an inserted photo and deleted source gap", () => {
  const words = [
    { text: "before", start: 101000, end: 101500 },
    { text: "removed", start: 115000, end: 115500 },
    { text: "after", start: 122000, end: 122500 },
  ];
  assert.deepEqual(retimeWordsWithMedia(words, 100, sections, [photo]), [
    { text: "before", start: 1000, end: 1500 },
    { text: "after", start: 15000, end: 15500 },
  ]);
});

test("split and delete preserve the imported media position", () => {
  assert.equal(mediaAfterSplit([photo], 0)[0].after, 1);
  assert.equal(mediaAfterDelete([photo, video], 0)[0].after, -1);
  assert.equal(mediaAfterDelete([photo, video], 0)[1].after, 0);
});

test("media validation rejects forged ids, positions, and oversized timelines", () => {
  assert.deepEqual(parseMediaInserts([photo], sections), [photo]);
  assert.throws(() => parseMediaInserts([{ ...photo, id: "../../private" }], sections));
  assert.throws(() => parseMediaInserts([{ ...photo, after: 3 }], sections));
  assert.throws(() => parseMediaInserts([{ ...photo, duration: 31 }], sections));
  assert.throws(() => parseMediaInserts([photo], [{ start: 0, end: 179 }]));
});

test("stored media paths stay inside the owning clip", () => {
  assert.equal(editorMediaPath(photo.id, video.id, photo.id, "image"),
    `${photo.id}/${video.id}/editor-${photo.id}.jpg`);
  assert.throws(() => editorMediaPath("../other", video.id, photo.id, "image"));
});
