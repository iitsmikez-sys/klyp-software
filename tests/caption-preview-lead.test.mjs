import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { clipTimeMs, archivedClipTiming } from "../lib/clip-trim.ts";
import { buildCaptionCues } from "../lib/captions.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");

test("a saved clip's file starts a whole second before the clip, so the lead is the fraction of the start time", () => {
  const timing = archivedClipTiming(4412.98);
  assert.equal(timing.sourceStart, 4412);
  assert.ok(Math.abs(timing.previewLead - 0.98) < 1e-9);
  assert.equal(archivedClipTiming(520).previewLead, 0);
});

test("clip time is video time minus the lead", () => {
  assert.equal(clipTimeMs(0.98, 0.98), 0);
  assert.equal(clipTimeMs(2.98, 0.98), 2000);
  assert.equal(clipTimeMs(5, 0), 5000);
  assert.equal(clipTimeMs(5), 5000);
});

test("a caption for a word said 1 second into a clip with a 0.98 second lead shows when the audio says it, not 0.98s early", () => {
  // The clip starts at 4412.98s, and the word is said at 4413.98s (1 second into the clip).
  const clipStart = 4412.98;
  const words = [{ text: "nope", start: 4413980, end: 4414300 }];
  const [cue] = buildCaptionCues(words, clipStart * 1000, (clipStart + 60) * 1000, 4);
  const { previewLead } = archivedClipTiming(clipStart);
  // In the video file that word is at (1.0 + lead) seconds.
  const wordInFile = 1 + previewLead;
  assert.ok(clipTimeMs(wordInFile, previewLead) >= cue.startMs && clipTimeMs(wordInFile, previewLead) < cue.endMs, "the caption is on when the word is said");
  // Without the lead (the old behavior) the caption would have appeared 0.98s early.
  assert.ok(clipTimeMs(wordInFile - 0.5, previewLead) < cue.startMs, "and it is not on half a second before");
  const earlyBy = cue.startMs - clipTimeMs(0, 0);
  assert.ok(earlyBy > 0);
});

test("the saved-clip preview passes its lead to the caption overlay, and the overlay uses it", () => {
  assert.match(read("components/ClipPreviewModal.tsx"), /leadSeconds=\{trimStart\}/);
  const overlay = read("components/FinishedLook.tsx");
  assert.match(overlay, /clipTimeMs\(videoRef\.current\?\.currentTime \?\? 0, leadSeconds\)/);
  assert.match(overlay, /leadSeconds = 0/);
});
