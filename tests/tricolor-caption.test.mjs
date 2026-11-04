import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CAPTION_STYLES } from "../lib/clips.ts";
import { generateAss, generateTimedCueAss, captionAppearance, wrapCaptionText } from "../lib/captions.ts";
import { hasFixedPalette, isHighlightStyle, wordLook } from "../lib/caption-looks.ts";

const bs = String.fromCharCode(92);
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");
const words = [["a", 0], ["if", 300], ["you", 600], ["join", 900]].map(([text, start]) => ({ text, start, end: start + 280 }));
const res = { w: 1080, h: 1920 };
const lines = (ass) => ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
const body = (line) => line.split(",,").pop();
const GREEN = "&H003AFF1F&", RED = "&H002A1FFF&", WHITE = "&H00FFFFFF&";

test("Tri-color is a style with its own palette and no emoji", () => {
  assert.ok(CAPTION_STYLES.includes("TRICOLOR"));
  assert.ok(isHighlightStyle("TRICOLOR") && hasFixedPalette("TRICOLOR"));
});

test("the phrase is white and the active word alternates bright green and red", () => {
  assert.equal(wordLook("TRICOLOR", 0, true).css, "#1FFF3A");
  assert.equal(wordLook("TRICOLOR", 1, true).css, "#FF1F2A");
  assert.equal(wordLook("TRICOLOR", 2, true).css, "#1FFF3A");
  assert.equal(wordLook("TRICOLOR", 1, false).css, "#FFFFFF");
  assert.equal(wordLook("FIRE", 1, true).css, "#39FF3A");
});

test("the export shows one colored word at a time, all the same size, on one line, with no emoji", () => {
  const ass = generateAss(words, 0, 1600, "TRICOLOR", res);
  const out = lines(ass);
  assert.equal(out.length, 4);
  // Two words per caption: "A IF", then "YOU JOIN", each colored word by word.
  assert.equal(body(out[0]), `{${bs}c${GREEN}}A{${bs}c${WHITE}} IF`);
  assert.equal(body(out[1]), `A {${bs}c${RED}}IF{${bs}c${WHITE}}`);
  assert.equal(body(out[2]), `{${bs}c${GREEN}}YOU{${bs}c${WHITE}} JOIN`);
  assert.ok(!ass.includes("fscx") && !ass.includes("Noto Emoji"), "no size jump, no emoji");
  assert.match(ass, /Style: Default,Poppins ExtraBold,60,&H00FFFFFF,/);
});

test("four words stay on one line", () => {
  assert.deepEqual(wrapCaptionText("OFF THE HAUNTED HOUSES.", "TRICOLOR"), ["OFF THE HAUNTED HOUSES."]);
  assert.equal(wrapCaptionText("OFF THE HAUNTED HOUSES.", "FIRE").length, 2);
});

test("the editor export draws Tri-color the same way", () => {
  const appearance = captionAppearance({ caption_color: "white", caption_position: "bottom" });
  const ass = generateTimedCueAss([{ id: "a", start_ms: 0, end_ms: 1200, text: "that was fire" }], "TRICOLOR", appearance, res);
  const out = lines(ass);
  assert.equal(out.length, 3);
  assert.ok(body(out[0]).includes(`{${bs}c${GREEN}}THAT`) && !ass.includes("Noto Emoji") && !ass.includes("fscx118"));
});

test("the picker and settings list Tri-color", () => {
  assert.ok(read("components/CaptionTemplatePicker.tsx").includes("name: 'Tri-color'"));
  assert.ok(read("app/(dashboard)/dashboard/settings/page.tsx").includes("TRICOLOR:"));
});
