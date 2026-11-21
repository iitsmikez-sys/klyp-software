import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { planChunks, perChunkCount, mergeChunkClips, CHUNK_MIN_SPAN_SECONDS, MAX_CHUNKS, CHUNK_OVERLAP_SECONDS, THIN_WINDOW_CLIPS } from "../lib/clip-extras.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");
const H = 3600;
const clip = (start, score) => ({ start_seconds: start, end_seconds: start + 30, viral_score: score });

test("a video under 36 minutes is read in one piece, exactly as before", () => {
  assert.deepEqual(planChunks(0, CHUNK_MIN_SPAN_SECONDS - 1), [{ start: 0, end: CHUNK_MIN_SPAN_SECONDS - 1 }]);
  assert.deepEqual(planChunks(0, 30 * 60), [{ start: 0, end: 1800 }]);
});

test("a long video is read in windows of about 20 minutes that cover all of it and overlap a little", () => {
  const plan = planChunks(0, 2 * H);
  assert.equal(plan.length, 6);
  assert.equal(plan[0].start, 0);
  assert.equal(plan.at(-1).end, 2 * H);
  for (let i = 1; i < plan.length; i++) {
    assert.ok(plan[i].start < plan[i - 1].end, "windows overlap");
    assert.ok(plan[i - 1].end - plan[i].start <= 2 * CHUNK_OVERLAP_SECONDS + 1);
  }
});

test("never more than 9 windows, however long, and a part of a video starts where the part starts", () => {
  assert.equal(planChunks(0, 10 * H).length, MAX_CHUNKS);
  const part = planChunks(3 * H, 5 * H);
  assert.equal(part[0].start, 3 * H);
  assert.equal(part.at(-1).end, 5 * H);
});

test("each window is asked for its share plus two spare, at least 4, as an allowed clip count", () => {
  assert.equal(perChunkCount(10, 4), 5);
  assert.equal(perChunkCount(10, 2), 7);
  assert.equal(perChunkCount(20, 5), 7);
  assert.equal(perChunkCount(20, 6), 7);
  assert.equal(perChunkCount(10, 10), 5);
  assert.ok([1, 2, 3, 5, 7, 10, 12, 15, 20].includes(perChunkCount(15, 4)));
});

test("merging keeps top picks first, then near-misses, drops overlaps between windows, and cuts to the total", () => {
  const merged = mergeChunkClips([
    [clip(100, 80), clip(600, 50), clip(1790, 70)],
    [clip(1800, 66), clip(1795, 60), clip(2400, 45), clip(3000, 30)],
  ], 5);
  assert.deepEqual(merged.map((c) => c.start_seconds), [100, 1790, 600, 2400, 3000], "1800 and 1795 sit next to the better 1790 and are dropped");
});

test("the merge never returns more than asked and ignores bad scores", () => {
  const many = Array.from({ length: 12 }, (_, i) => clip(i * 300, 40 + i));
  assert.equal(mergeChunkClips([many], 7).length, 7);
  assert.equal(mergeChunkClips([[clip(0, Number.NaN)]], 5).length, 0);
});

test("the pipeline uses the windowed finder for both clip-finding passes and keeps the old result cache apart", () => {
  const p = read("lib/analyze-pipeline.ts");
  assert.equal(p.split("findClipsAcrossVod({").length - 1, 2);
  assert.ok(p.includes('"chunk-v2"'));
  assert.ok(p.includes("const plan = planChunks(spanStart, spanEnd);"));
  assert.ok(p.includes("if (plan.length === 1) {"), "a short video is one call");
  assert.ok(p.includes("Promise.allSettled"), "one failed window does not lose the others");
  assert.ok(p.includes("[{ start: w.start, end: w.end }], args.model"), "a window only keeps clips inside itself");
});

test("results with near-misses show a 'More moments to browse' heading before the first one, only when top picks come first", () => {
  const panel = read("components/AnalyzePanel.tsx");
  assert.ok(panel.includes("extraCount > 0 && !isTopPick(clip) && i > 0 && isTopPick(clips[i - 1])"));
  assert.ok(panel.includes("More moments to browse"));
});

test("each window is told it is one part of a longer stream and to score on the whole-stream scale", () => {
  const src = read("lib/analyze-pipeline.ts");
  assert.ok(src.includes("ONE PART of a much longer stream"), "the scoring note exists");
  assert.ok(src.includes("args.nonEnglish, 8000, true, retryThin)"), "windows turn the note on");
});

test("a window full of speech that came back almost empty is asked once more, and the better answer is kept", () => {
  const p = read("lib/analyze-pipeline.ts");
  assert.ok(p.includes("firstTry.clips.length >= THIN_WINDOW_CLIPS || windowWords.length < THIN_WINDOW_MIN_WORDS"));
  assert.ok(p.includes("secondTry.clips.length > firstTry.clips.length ? secondTry : firstTry"));
  assert.ok(p.includes("A first read of this part found almost nothing"));
  assert.equal(THIN_WINDOW_CLIPS, 3);
});
