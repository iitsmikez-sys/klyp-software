import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildCaptionCues, CUE_MAX_WORDS, generateAss } from "../lib/captions.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");
const word = (text, start) => ({ text, start, end: start + 250 });
const sentence = "this team is so bad honestly no way we lost that".split(" ").map((t, i) => word(t, 1000 + i * 320));

test("captions hold two words by default", () => {
  assert.equal(CUE_MAX_WORDS, 2);
  const cues = buildCaptionCues(sentence, 0, 20000);
  assert.ok(cues.length >= 6);
  for (const cue of cues) assert.ok(cue.text.split(" ").length <= 2, cue.text);
  assert.equal(cues.map((c) => c.text).join(" "), sentence.map((w) => w.text).join(" "));
});

test("one-word styles stay one word, and an explicit number is still respected", () => {
  assert.ok(buildCaptionCues(sentence, 0, 20000, 1).every((c) => c.text.split(" ").length === 1));
  assert.ok(buildCaptionCues(sentence, 0, 20000, 4).some((c) => c.text.split(" ").length === 4));
});

test("an exported caption never shows a word before it is said by more than about a word's length", () => {
  const cues = buildCaptionCues(sentence, 0, 20000);
  let used = 0;
  for (const cue of cues) {
    const n = cue.text.split(" ").length;
    const group = sentence.slice(used, used + n); used += n;
    for (const w of group) assert.ok(w.start - (cue.startMs + 50) <= 320, `${w.text} shown ${w.start - cue.startMs - 50}ms early`);
  }
});

test("the exported file gives each two-word caption its own event", () => {
  const ass = generateAss(sentence, 0, 20000, "BOLD");
  const events = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
  assert.equal(events.length, buildCaptionCues(sentence, 0, 20000).length);
});

test("every place that builds captions uses the shared two-word setting", () => {
  for (const file of ["lib/editor-captions.ts", "components/ClipTimelineEditor.tsx", "components/VerticalLayoutPreview.tsx", "components/LegacySavedClipEditor.tsx"]) {
    const source = read(file);
    assert.match(source, /CUE_MAX_WORDS/, file);
    assert.doesNotMatch(source, /\? 1 : 4\)/, `${file} still hard-codes four words`);
  }
});
