import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildSegmentFilter,
  deleteSegment,
  parseSegments,
  retimeWords,
  segmentIndexAtSource,
  sourceTimeAt,
  splitSegment,
  trimSegment,
  timelineDuration,
  timelineTimeAt,
} from "../lib/edit-segments.ts";

test("splitting and deleting a middle section closes the timeline gap", () => {
  const first = splitSegment([{ start: 0, end: 60 }], 0, 15);
  const three = splitSegment(first, 1, 30);
  assert.deepEqual(three, [
    { start: 0, end: 15 },
    { start: 15, end: 30 },
    { start: 30, end: 60 },
  ]);
  const kept = deleteSegment(three, 1);
  assert.deepEqual(kept, [{ start: 0, end: 15 }, { start: 30, end: 60 }]);
  assert.equal(timelineDuration(kept), 45);
  assert.equal(sourceTimeAt(kept, 15), 30);
  assert.equal(timelineTimeAt(kept, 32), 17);
  assert.equal(segmentIndexAtSource(kept, 20), -1);
});

test("FFmpeg exports only the kept sections with continuous audio", () => {
  const dir = mkdtempSync(join(tmpdir(), "klyp-segments-"));
  try {
    const source = join(dir, "source.mp4");
    const output = join(dir, "output.mp4");
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i",
      "testsrc2=size=160x90:rate=10:duration=12", "-f", "lavfi", "-i",
      "sine=frequency=440:duration=12", "-shortest", "-c:v", "libx264",
      "-c:a", "aac", source]);
    const trimmed = trimSegment([{ start: 0, end: 6 }], 0, "start", 1, 6);
    const firstCut = splitSegment(trimmed, 0, 2);
    const secondCut = splitSegment(firstCut, 1, 4);
    const kept = deleteSegment(secondCut, 1);
    const { graph, videoLabel, audioLabel } = buildSegmentFilter(kept, "scale=160:90");
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-ss", "5", "-t", "6", "-i", source,
      "-filter_complex", graph, "-map", videoLabel, "-map", audioLabel,
      "-c:v", "libx264", "-c:a", "aac", output]);
    const duration = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries",
      "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", output],
    { encoding: "utf8" }).trim());
    assert.ok(duration > 2.9 && duration < 3.2, `expected 3 seconds, got ${duration}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("FFmpeg can join silent video sections", () => {
  const dir = mkdtempSync(join(tmpdir(), "klyp-silent-segments-"));
  try {
    const source = join(dir, "silent.mp4");
    const output = join(dir, "output.mp4");
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i",
      "testsrc2=size=160x90:rate=10:duration=6", "-c:v", "libx264", source]);
    const { graph, videoLabel, audioLabel } = buildSegmentFilter(
      [{ start: 0, end: 2 }, { start: 4, end: 6 }], "scale=160:90", false
    );
    assert.equal(audioLabel, null);
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", source,
      "-filter_complex", graph, "-map", videoLabel, "-c:v", "libx264", output]);
    const duration = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries",
      "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", output],
    { encoding: "utf8" }).trim());
    assert.ok(duration > 3.9 && duration < 4.2, `expected 4 seconds, got ${duration}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("segment validation rejects overlaps, empty cuts, and out-of-range times", () => {
  assert.deepEqual(parseSegments([{ start: 0, end: 10 }, { start: 20, end: 30 }], 60), [
    { start: 0, end: 10 }, { start: 20, end: 30 },
  ]);
  assert.throws(() => parseSegments([{ start: 10, end: 20 }, { start: 19, end: 30 }], 60));
  assert.throws(() => parseSegments([{ start: 0, end: 0 }], 60));
  assert.throws(() => parseSegments([{ start: 0, end: 61 }], 60));
  assert.throws(() => parseSegments([{ start: NaN, end: 20 }], 60));
});

test("caption words after a deleted section move to the new output time", () => {
  const kept = [{ start: 0, end: 15 }, { start: 30, end: 60 }];
  const words = [
    { text: "before", start: 101000, end: 101500 },
    { text: "removed", start: 120000, end: 120500 },
    { text: "after", start: 132000, end: 132500 },
  ];
  assert.deepEqual(retimeWords(words, 100, kept), [
    { text: "before", start: 1000, end: 1500 },
    { text: "after", start: 17000, end: 17500 },
  ]);
});

test("trim, split, delete and undo preserve a valid export timeline", () => {
  const original = [{ start: 0, end: 60 }];
  const trimmed = trimSegment(original, 0, "start", 10, 60);
  const split = splitSegment(trimmed, 0, 30);
  const cut = deleteSegment(split, 0);
  const final = trimSegment(cut, 0, "end", 48, 60);
  assert.deepEqual(final, [{ start: 30, end: 48 }]);
  assert.deepEqual(parseSegments(final, 60), final);
  assert.equal(timelineDuration(final), 18);
  assert.equal(sourceTimeAt(final, 0), 30);
  assert.deepEqual(split, [{ start: 10, end: 30 }, { start: 30, end: 60 }]);
  assert.deepEqual(retimeWords([
    { text: "removed", start: 120000, end: 120500 },
    { text: "kept", start: 132000, end: 132500 },
    { text: "trimmed", start: 151000, end: 151500 },
  ], 100, final), [{ text: "kept", start: 2000, end: 2500 }]);
});

test("trim selected section cannot overlap its neighbors", () => {
  const sections = [{ start: 0, end: 10 }, { start: 20, end: 30 }, { start: 40, end: 50 }];
  assert.deepEqual(trimSegment(sections, 1, "start", 5, 60)[1], { start: 10, end: 30 });
  assert.deepEqual(trimSegment(sections, 1, "end", 55, 60)[1], { start: 20, end: 40 });
});
