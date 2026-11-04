import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildCaptionCues, keywordAtTime, keywordWeights, generateAss, CUE_TAIL_MS, CUE_MIN_SHOW_MS, CUE_MAX_SHOW_MS, CUE_GAP_SPLIT_MS, CUE_LEAD_MS } from "../lib/captions.ts";

const w = (text, start, end) => ({ text, start, end });
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");

test("a caption goes away shortly after the last word is said, not after a fixed pause", () => {
  const cues = buildCaptionCues([w("no", 1000, 1200), w("way", 1250, 1500), w("dude", 1550, 1900)], 0, 20000, 4);
  assert.equal(cues.length, 1);
  assert.equal(cues[0].startMs, 1000 - CUE_LEAD_MS);
  assert.equal(cues[0].endMs, 1900 + CUE_TAIL_MS);
});

test("a very quick word still stays up long enough to read, and a long word does not keep the text up forever", () => {
  const quick = buildCaptionCues([w("ok", 1000, 1100)], 0, 20000, 4);
  assert.equal(quick[0].endMs - quick[0].startMs, CUE_MIN_SHOW_MS);
  const drawn = buildCaptionCues([w("noooo", 1000, 9000)], 0, 20000, 4);
  assert.equal(drawn[0].endMs - drawn[0].startMs, CUE_MAX_SHOW_MS);
});

test("a pause starts a new caption, so later words do not show before they are said", () => {
  const words = [w("wait", 1000, 1300), w("what", 1350, 1600), w("did", 1600 + CUE_GAP_SPLIT_MS + 100, 2300), w("he", 2350, 2500)];
  const cues = buildCaptionCues(words, 0, 20000, 4);
  assert.deepEqual(cues.map((c) => c.text), ["wait what", "did he"]);
  const closeTogether = buildCaptionCues([w("wait", 1000, 1300), w("what", 1350, 1600), w("did", 1600 + CUE_GAP_SPLIT_MS - 50, 2300)], 0, 20000, 4);
  assert.equal(closeTogether.length, 1);
});

test("a caption never overlaps the next one or runs past the end of the clip", () => {
  const cues = buildCaptionCues([w("one", 1000, 1200), w("two", 1250, 1450), w("three", 1500, 1700), w("four", 1750, 1950), w("five", 2000, 2200)], 0, 2300, 4);
  assert.ok(cues.length >= 2);
  for (let i = 0; i < cues.length; i++) {
    assert.ok(cues[i].endMs <= 2300);
    if (i + 1 < cues.length) assert.ok(cues[i].endMs <= cues[i + 1].startMs);
  }
});

test("one-word captions are timed to the word", () => {
  const cues = buildCaptionCues([w("hello", 1000, 1400), w("world", 2000, 2400)], 0, 20000, 1);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].endMs, 1400 + CUE_TAIL_MS);
  assert.equal(cues[1].startMs, 2000 - CUE_LEAD_MS);
});

test("the highlighted word spends longer on longer words", () => {
  assert.deepEqual(keywordWeights("a bigger plan"), [2, 7, 5]);
  assert.deepEqual(keywordWeights("  "), []);
  assert.deepEqual(keywordWeights("não é fácil!"), [4, 2, 6]);
  // "I" is quick, "ABSOLUTELY" takes most of the caption.
  const weights = keywordWeights("I ABSOLUTELY");
  assert.equal(keywordAtTime(100, 1000, 2, weights), 0);
  assert.equal(keywordAtTime(250, 1000, 2, weights), 1);
  assert.equal(keywordAtTime(999, 1000, 2, weights), 1);
  // Without weights, or with the wrong number of them, the steps stay even like before.
  assert.equal(keywordAtTime(350, 900, 3), 1);
  assert.equal(keywordAtTime(350, 900, 3, [1, 1]), 1);
  assert.equal(keywordAtTime(0, 900, 0, []), -1);
});

test("the exported highlight changes word at the same moments as the live preview", () => {
  // FIRE highlights one word at a time: "I" then "ABSOLUTELY" over a 1000ms caption.
  const words = [w("I", 1000, 1100), w("absolutely", 1150, 2000)];
  const ass = generateAss(words, 0, 5000, "FIRE");
  const events = ass.split("\n").filter((line) => line.startsWith("Dialogue:"));
  assert.equal(events.length, 2);
  const [first, second] = events.map((line) => line.split(",").slice(1, 3));
  const ms = (t) => { const [h, m, s] = t.split(":"); return Math.round((Number(h) * 3600 + Number(m) * 60 + Number(s)) * 1000); };
  const cue = buildCaptionCues(words, 0, 5000, 4)[0];
  const weights = keywordWeights("I absolutely");
  const splitMs = cue.startMs + (cue.endMs - cue.startMs) * weights[0] / (weights[0] + weights[1]);
  assert.ok(Math.abs(ms(first[1]) - splitMs) <= 10, `${first[1]} vs ${splitMs}`);
  assert.equal(ms(second[0]), ms(first[1]));
  // The preview picks the same word either side of that moment.
  assert.equal(keywordAtTime(splitMs - 20 - cue.startMs, cue.endMs - cue.startMs, 2, weights), 0);
  assert.equal(keywordAtTime(splitMs + 20 - cue.startMs, cue.endMs - cue.startMs, 2, weights), 1);
});

test("every preview and export path passes the word weights", () => {
  assert.match(read("lib/caption-preview.ts"), /keywordWeights\(text\)/);
  assert.match(read("components/VerticalLayoutPreview.tsx"), /keywordWeights\(activeCaption\.text\)/);
  assert.match(read("components/VerticalLayoutPreview.tsx"), /keywordWeights\(caption\)/);
  const captions = read("lib/captions.ts");
  assert.match(captions, /keywordBoundaries\(keywordWeights\(lines\.join/);
  assert.match(captions, /keywordBoundaries\(keywordWeights\(layout\.lines/);
});
