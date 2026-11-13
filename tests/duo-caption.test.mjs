import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CAPTION_STYLES, isProCaptionStyle } from "../lib/clips.ts";
import { generateAss, generateTimedCueAss, captionAppearance } from "../lib/captions.ts";
import { activeWordScale, duoColorIndex, hasFixedPalette, isOneWordStyle, wordLook } from "../lib/caption-looks.ts";

const bs = String.fromCharCode(92);
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");
const text = "that was the craziest second of the whole run and nobody saw it coming".split(" ");
const words = text.map((t, i) => ({ text: t, start: i * 400, end: i * 400 + 350 }));
const res = { w: 1080, h: 1920 };
const lines = (ass) => ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
const body = (line) => line.split(",,").pop();
const GREEN = "&H003AFF1F&", RED = "&H002A1FFF&";

test("Duo is a Pro style that shows one word at a time with its own colors", () => {
  assert.ok(CAPTION_STYLES.includes("DUO"));
  assert.ok(isProCaptionStyle("DUO"));
  assert.ok(isOneWordStyle("DUO") && hasFixedPalette("DUO"));
  assert.equal(activeWordScale("DUO"), 1.25);
  // Tri-color is untouched: still a phrase with a lit word, not one word at a time.
  assert.ok(!isOneWordStyle("TRICOLOR"));
  assert.equal(wordLook("TRICOLOR", 1, true).css, "#FF1F2A");
});

test("a word's color depends only on when it starts, and both colors really show up", () => {
  for (const seed of [0, 400, 12345, 99999]) assert.equal(duoColorIndex(seed), duoColorIndex(seed));
  const colors = words.map((w) => wordLook("DUO", 0, true, w.start).css);
  assert.deepEqual([...new Set(colors)].sort(), ["#1FFF3A", "#FF1F2A"]);
  // Over many words it is close to an even mix, not mostly one color.
  const reds = Array.from({ length: 2000 }, (_, i) => duoColorIndex(i * 137)).filter((n) => n === 1).length;
  assert.ok(reds > 800 && reds < 1200, `reds ${reds}`);
  // Not lit: white, like the other highlight styles.
  assert.equal(wordLook("DUO", 0, false, 400).css, "#FFFFFF");
});

test("the export draws each word on its own, 25% larger, in the color for its start time", () => {
  const ass = generateAss(words, 0, 5000, "DUO", res, 0, true);
  const out = lines(ass);
  assert.ok(out.length >= 10);
  for (const line of out) {
    const b = body(line);
    assert.ok(!b.includes(bs + "N"), "one line");
    assert.match(b, new RegExp(`^\{${bs}${bs}c(${GREEN}|${RED})${bs}${bs}fscx125${bs}${bs}fscy125\}[A-Z']+\{`), b);
  }
  const used = new Set(out.map((l) => (body(l).includes(GREEN) ? "g" : "r")));
  assert.equal(used.size, 2, "both green and red appear");
  // Each caption's color matches the rule for its start time.
  out.forEach((line) => {
    const startMs = Number(line.split(",")[1].replace(/(\d+):(\d+):(\d+)\.(\d+)/, (_, h, m, s, cs) => String(((+h * 60 + +m) * 60 + +s) * 1000 + +cs * 10)));
    assert.equal(body(line).includes(duoColorIndex(startMs) ? RED : GREEN), true, `${startMs}`);
  });
});

test("the editor export draws Duo the same way", () => {
  const appearance = captionAppearance({ caption_color: "white", caption_position: "bottom" });
  const ass = generateTimedCueAss([{ id: "a", start_ms: 1000, end_ms: 1400, text: "second" }], "DUO", appearance, res);
  const out = lines(ass);
  assert.equal(out.length, 1);
  assert.ok(body(out[0]).includes(duoColorIndex(1000) ? RED : GREEN));
  assert.ok(body(out[0]).includes("SECOND"));
});

test("the picker and previews know about Duo", () => {
  assert.ok(read("components/CaptionTemplatePicker.tsx").includes("name: 'Duo'"));
  assert.ok(read("components/CaptionTemplatePicker.tsx").includes("'FOCUS', 'DUO'"));
  assert.ok(read("components/ClipPreview.tsx").includes("DUO:"));
  assert.ok(read("components/VerticalLayoutPreview.tsx").includes("activeCaption.start_ms") && read("components/VerticalLayoutPreview.tsx").includes("active.startMs"));
  assert.ok(read("lib/caption-preview.ts").includes("cue.startMs"));
});
