import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { trimClip, trimClipBatch } from "../lib/clip-cut-snap.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");

// A talking clip: a rambling lead-in, the story, the punchline at 35s, then talk after it.
const say = (text, startS, endS) => text.split(" ").map((w, i, all) => {
  const step = (endS - startS) / all.length;
  return { text: w, start: Math.round((startS + i * step) * 1000), end: Math.round((startS + (i + 1) * step - 0.05) * 1000) };
});
const words = [
  ...say("or because everyone said you for not streaming for like two weeks anyways", 0, 8),
  ...say("so I threw a Halloween party in my apartment and cops got called", 8, 16),
  ...say("it was our second warning which no one knew", 16, 24),
  ...say("so we got an eviction notice", 24, 30),
  ...say("so it's like we're good then", 30, 35),
  ...say("appreciate it bro", 35, 37),
  ...say("yo merry christmas guys what is Thanksgiving deadass", 37, 50),
];
const clip = (over = {}) => ({ start_seconds: 0, end_seconds: 50, thumbnail_seconds: 10, start_quote: "so I threw a Halloween party", end_quote: "so it's like we're good then", ...over });

test("the cut starts on the hook line and ends right after the punchline", () => {
  const out = trimClip(clip(), words);
  assert.ok(out.start_seconds >= 7.5 && out.start_seconds <= 8.1, `start ${out.start_seconds}`);
  assert.ok(out.end_seconds >= 34.8 && out.end_seconds <= 35.8, `end ${out.end_seconds}`);
  assert.ok(out.end_seconds - out.start_seconds < 30);
});

test("quotes are matched ignoring case and punctuation", () => {
  const out = trimClip(clip({ start_quote: "So, I threw a HALLOWEEN party!", end_quote: "So it's like, we're good then." }), words);
  assert.ok(out.start_seconds > 7 && out.end_seconds < 36);
});

test("a quote that is not in the transcript leaves that side alone", () => {
  const out = trimClip(clip({ start_quote: "this was never said anywhere", end_quote: "so it's like we're good then" }), words);
  assert.equal(out.start_seconds, 0);
  assert.ok(out.end_seconds < 36);
  assert.equal(trimClip(clip({ start_quote: "nope nope nope", end_quote: "also never said" }), words).end_seconds, 50);
});

test("clips without quotes (older results) are returned unchanged", () => {
  const old = clip({ start_quote: undefined, end_quote: undefined });
  assert.deepEqual(trimClip(old, words), old);
});

test("a start quote that would leave under 12 seconds before the end is not used", () => {
  const out = trimClip(clip({ end_seconds: 40, start_quote: "so it's like we're good then", end_quote: "appreciate it bro" }), words);
  assert.equal(out.start_seconds, 0, "the start stays where it was");
  assert.ok(out.end_seconds - out.start_seconds >= 12);
});

test("a quote far from the proposed cut is not trusted", () => {
  const out = trimClip(clip({ start_seconds: 40, end_seconds: 50, start_quote: "so I threw a Halloween party", end_quote: "what is Thanksgiving deadass" }), words);
  assert.equal(out.start_seconds, 40);
});

test("the thumbnail time stays inside the new cut, whether it was given from the clip start or the VOD start", () => {
  const fromClipStart = trimClip(clip({ thumbnail_seconds: 3 }), words);
  assert.ok(fromClipStart.thumbnail_seconds >= fromClipStart.start_seconds && fromClipStart.thumbnail_seconds < fromClipStart.end_seconds);
  const fromVodStart = trimClip(clip({ start_seconds: 0, thumbnail_seconds: 20 }), words);
  assert.equal(fromVodStart.thumbnail_seconds, 20);
  const outside = trimClip(clip({ thumbnail_seconds: 45 }), words);
  assert.ok(outside.thumbnail_seconds < outside.end_seconds);
});

test("trimClipBatch trims every clip and keeps their order", () => {
  const out = trimClipBatch([clip(), clip({ start_quote: undefined, end_quote: undefined })], words);
  assert.ok(out[0].end_seconds < 36);
  assert.equal(out[1].end_seconds, 50);
});

test("the pipeline snaps the cuts before the boundary review, asks for quotes, aims for 20-40s, and keeps old cached results apart", () => {
  const pipe = read("lib/analyze-pipeline.ts");
  assert.match(pipe, /reviewClipBatch\(trimClipBatch\(judged, words\), words, durationSeconds\)/);
  assert.match(pipe, /reviewClipBatch\(trimClipBatch\(nextJudged, words\), words, durationSeconds\)/);
  assert.match(pipe, /AIM FOR 20-40 seconds/);
  assert.match(pipe, /start_quote and end_quote/);
  assert.match(pipe, /"trim-v1"/);
  assert.match(pipe, /why it is NOT scored higher/);
  const schema = read("lib/clips.ts");
  assert.match(schema, /start_quote: z/);
  assert.match(schema, /end_quote: z/);
});
