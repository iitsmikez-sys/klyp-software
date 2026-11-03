import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CAPTION_STYLES } from "../lib/clips.ts";
import { generateAss, generateTimedCueAss, captionAppearance } from "../lib/captions.ts";
import { hasFixedPalette, isHighlightStyle, wordLook } from "../lib/caption-looks.ts";

const bs = String.fromCharCode(92);
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");
const words = [["the", 0], ["quick", 300], ["brown", 600], ["fire", 900], ["fox", 1200]].map(([text, start]) => ({ text, start, end: start + 280 }));
const res = { w: 1080, h: 1920 };
const lines = (ass) => ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
const GREEN = "&H003AFF1F&", RED = "&H002A1FFF&", WHITE = "&H00FFFFFF&";

test("Tri-color is a style with its own palette and no emoji", () => {
  assert.ok(CAPTION_STYLES.includes("TRICOLOR"));
  assert.ok(isHighlightStyle("TRICOLOR") && hasFixedPalette("TRICOLOR"));
});

test("words rotate bright green, red, white by position", () => {
  assert.equal(wordLook("TRICOLOR", 0, false).css, "#1FFF3A");
  assert.equal(wordLook("TRICOLOR", 1, true).css, "#FF1F2A");
  assert.equal(wordLook("TRICOLOR", 2, false).css, "#FFFFFF");
  assert.equal(wordLook("TRICOLOR", 3, false).css, "#1FFF3A");
  assert.equal(wordLook("FIRE", 3, false).css, "#FFFFFF");
});

test("the export colors every word, enlarges the active one and adds no emoji", () => {
  const out = lines(generateAss(words, 0, 1600, "TRICOLOR", res));
  assert.ok(out.length >= 4);
  const first = out[0].split(",,").pop();
  assert.ok(first.startsWith(`{${bs}c${GREEN}${bs}fscx118${bs}fscy118}THE`), first);
  assert.ok(first.includes(`{${bs}c${RED}${bs}fscx100${bs}fscy100}QUICK`), first);
  assert.ok(first.includes(`{${bs}c${WHITE}${bs}fscx100${bs}fscy100}BROWN`), first);
  assert.ok(first.includes(`{${bs}c${GREEN}${bs}fscx100${bs}fscy100}FIRE`), "fourth word is green again");
  assert.ok(out[1].split(",,").pop().includes(`{${bs}c${RED}${bs}fscx118${bs}fscy118}QUICK`), "the active word moves on");
  assert.ok(out.every((l) => !l.includes("Noto Emoji")), "no emoji, even for the word fire");
});

test("the editor export draws Tri-color the same way", () => {
  const appearance = captionAppearance({ caption_color: "white", caption_position: "bottom" });
  const ass = generateTimedCueAss([{ id: "a", start_ms: 0, end_ms: 1200, text: "that was fire" }], "TRICOLOR", appearance, res);
  const out = lines(ass);
  assert.equal(out.length, 3);
  assert.ok(out[0].includes(`{${bs}c${GREEN}${bs}fscx118`) && !ass.includes("Noto Emoji"));
});

test("the picker and settings list Tri-color", () => {
  assert.ok(read("components/CaptionTemplatePicker.tsx").includes("name: 'Tri-color'"));
  assert.ok(read("app/(dashboard)/dashboard/settings/page.tsx").includes("TRICOLOR:"));
});
