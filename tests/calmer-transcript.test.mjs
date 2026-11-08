import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { groupTranscriptParagraphs } from "../lib/transcript-paragraphs.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");
const make = (texts) => texts.map((text, i) => ({ text, start: i * 400, end: i * 400 + 300 }));
const sentenceAt = (n, at) => Array.from({ length: n }, (_, i) => (at.includes(i) ? `end${i}.` : `w${i}`));

test("a block ends at a sentence end as soon as it has about ten words, so blocks are whole sentences", () => {
  const words = make(sentenceAt(30, [11, 24]));
  const paragraphs = groupTranscriptParagraphs(words);
  assert.deepEqual(paragraphs.map((p) => p.text.split(" ").length), [12, 13, 5]);
  assert.ok(paragraphs[0].text.endsWith("end11."));
  assert.ok(paragraphs[1].text.endsWith("end24."));
});

test("a very short sentence stays with the next one instead of becoming a block of its own", () => {
  const words = make(sentenceAt(24, [2, 15]));
  const paragraphs = groupTranscriptParagraphs(words);
  assert.ok(paragraphs[0].text.split(" ").length >= 10, "no 3-word block");
  assert.ok(paragraphs[0].text.endsWith("end15."));
});

test("when a block hits its length limit it is cut at the last sentence end, not in the middle of a sentence", () => {
  // The only sentence end is word 8 (too early to split on its own), then 50 words with none: the limit forces a cut.
  const words = make(sentenceAt(60, [8]));
  const paragraphs = groupTranscriptParagraphs(words);
  assert.ok(paragraphs[0].text.endsWith("end8."), `first block ends at the sentence end: ${paragraphs[0].text.slice(-20)}`);
  assert.equal(paragraphs[0].text.split(" ").length, 9);
  assert.ok(paragraphs.every((p) => p.text.split(" ").length <= 42), "no block is longer than 42 words");
  assert.deepEqual(paragraphs.flatMap((p) => p.text.split(" ")), words.map((w) => w.text), "no word lost, none out of order");
});

test("a long run with no sentence end at all is still cut at the limit", () => {
  const words = make(sentenceAt(100, []));
  const paragraphs = groupTranscriptParagraphs(words);
  assert.ok(paragraphs.length >= 3);
  assert.ok(paragraphs.every((p) => p.text.split(" ").length <= 42));
  assert.deepEqual(paragraphs.flatMap((p) => p.text.split(" ")), words.map((w) => w.text));
});

test("timestamps stay exact after the new breaks", () => {
  const words = make(sentenceAt(40, [11, 26]));
  const paragraphs = groupTranscriptParagraphs(words);
  assert.equal(paragraphs[0].start_ms, words[0].start);
  assert.equal(paragraphs[0].end_ms, words[11].end);
  assert.equal(paragraphs[1].start_ms, words[12].start);
  assert.equal(paragraphs.at(-1).end_ms, words.at(-1).end);
});

test("the transcript text is regular weight, not bold, and the active block still stands out", () => {
  const css = read("components/clip-timeline-editor.css");
  assert.match(css, /\.editor-transcript-lines button \{[^}]*font-weight:400 \}/);
  assert.doesNotMatch(css, /\.editor-transcript-lines button \{[^}]*font-weight:550/);
  assert.match(css, /\.editor-transcript-lines button\[aria-current=true\] \{ background:#172520/);
});

test("Quick cleanup stays exactly where it was: no 'fixes ready' chip at the top, the collapsed bar at the bottom", () => {
  const src = read("components/EditorTranscript.tsx");
  assert.doesNotMatch(src, /fixes ready|editor-cleanup-chip|cleanupOpen/);
  assert.doesNotMatch(read("components/clip-timeline-editor.css"), /editor-cleanup-chip/);
  assert.match(src, /<details className="editor-cleanup editor-cleanup-collapsed">/);
  assert.match(src, /Quick cleanup\{cleanup\.length > 0 \? ` · \$\{cleanup\.length\} suggestions` : ''\}/);
  assert.match(src, /Review each suggested cut before applying it\./);
});

test("filler words are not dimmed or struck through in the transcript", () => {
  const src = read("components/EditorTranscript.tsx") + read("components/clip-timeline-editor.css");
  assert.doesNotMatch(src, /line-through/);
});
