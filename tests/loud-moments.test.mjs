import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseLoudnessMetadata, findLoudMoments, formatLoudMomentsForPrompt, speechWordsPerMinute, isQuietStream, defaultFilterPath, detectLoudMoments } from "../lib/loud-moments.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");
// 0.1 second readings: steady at -30 LUFS, with a loud burst at 40-43s and another at 95-97s.
const samples = [];
for (let i = 0; i < 1200; i++) { const t = i / 10; samples.push({ t, m: (t >= 40 && t < 43) ? -8 : (t >= 95 && t < 97) ? -6 : -30 }); }

test("the loudness readings are parsed from FFmpeg's metadata text", () => {
  const text = ["frame:0    pts:0       pts_time:0", "lavfi.r128.M=-120.691", "frame:1    pts:1600    pts_time:0.1", "lavfi.r128.M=-22.5", "frame:2    pts:3200    pts_time:0.2", "lavfi.r128.M=-inf"].join("\n");
  assert.deepEqual(parseLoudnessMetadata(text), [{ t: 0, m: -120.691 }, { t: 0.1, m: -22.5 }, { t: 0.2, m: -120 }]);
});

test("stretches far above the usual volume become moments, loudest first when trimmed", () => {
  const moments = findLoudMoments(samples);
  assert.deepEqual(moments.map((m) => [m.start_seconds, m.end_seconds, m.peak_seconds]), [[40, 43, 40], [95, 97, 95]]);
  assert.ok(moments[0].lift_db >= 20 && moments[1].lift_db >= 20);
});

test("a steady stream, silence and too little audio give no moments", () => {
  assert.deepEqual(findLoudMoments(samples.map((s) => ({ ...s, m: -30 }))), []);
  assert.deepEqual(findLoudMoments(samples.map((s) => ({ ...s, m: -120 }))), []);
  assert.deepEqual(findLoudMoments(samples.slice(0, 20)), []);
  assert.deepEqual(findLoudMoments(samples.map((s) => ({ ...s, m: s.t >= 40 && s.t < 41 ? -26 : -30 }))), [], "a small bump is not a moment");
});

test("moments close together merge into one", () => {
  const close = samples.map((s) => ({ ...s, m: (s.t >= 40 && s.t < 42) || (s.t >= 46 && s.t < 48) ? -8 : -30 }));
  assert.deepEqual(findLoudMoments(close).map((m) => [m.start_seconds, m.end_seconds]), [[40, 48]]);
});

test("the prompt lists the moments with times, and leans on them when the stream is quiet", () => {
  const moments = findLoudMoments(samples);
  const quiet = formatLoudMomentsForPrompt(moments, true), talky = formatLoudMomentsForPrompt(moments, false);
  assert.ok(quiet.includes("0:40 to 0:43") && quiet.includes("1:35 to 1:37"));
  assert.ok(quiet.includes("talks very little") && !talky.includes("talks very little"));
  assert.equal(formatLoudMomentsForPrompt([], true), "");
});

test("quiet streams are those under 40 words a minute, once the video is at least 5 minutes", () => {
  assert.equal(speechWordsPerMinute(1600, 51 * 60), 31.4);
  assert.equal(isQuietStream(1600, 51 * 60), true);
  assert.equal(isQuietStream(300, 20 * 60), true);
  assert.equal(isQuietStream(6000, 51 * 60), false);
  assert.equal(isQuietStream(10, 120), false, "a very short video is not judged");
});

test("measuring never fails an analysis, and Windows paths are escaped for the filter", async () => {
  assert.deepEqual(await detectLoudMoments("x.mp3", { run: async () => { throw new Error("ffmpeg missing"); }, readText: async () => "", ffmpeg: "ffmpeg", outPath: "o.txt" }), []);
  assert.equal(defaultFilterPath(String.raw`C:\tmp\work\loudness.txt`), String.raw`C\:/tmp/work/loudness.txt`);
  assert.equal(defaultFilterPath("/tmp/work/loudness.txt"), "/tmp/work/loudness.txt");
});

test("the pipeline measures Gaming audio, flags quiet streams, and gives the result back to the screen", () => {
  const pipeline = read("lib/analyze-pipeline.ts");
  assert.ok(pipeline.includes('if (contentType === "gaming") {') && pipeline.includes("detectLoudMoments(audioPath"));
  assert.ok(pipeline.includes("loudMoments, quietStream, nonEnglish));") && pipeline.includes("quiet: quietStream"));
  assert.ok(pipeline.includes('contentType === "gaming" ? formatLoudMomentsForPrompt(loudMoments, quietStream)'));
  assert.ok(read("app/api/analyze/route.ts").includes("quiet: pipelineResult.quiet === true"));
  assert.ok(read("components/AnalyzePanel.tsx").includes("This streamer talks very little"));
});

test("longer streams get more hints, but never more than about one every 3 minutes", async () => {
  const { maxMomentsFor } = await import("../lib/loud-moments.ts");
  assert.deepEqual([60, 1200, 3600, 7200, 36000].map(maxMomentsFor), [5, 7, 20, 20, 20]);
  // 30 identical bursts in a 20-minute stream: only the allowed number come back.
  const busy = [];
  for (let i = 0; i < 12000; i++) { const t = i / 10; busy.push({ t, m: (t % 40) < 3 ? -8 : -30 }); }
  assert.equal(findLoudMoments(busy).length, 7);
});
