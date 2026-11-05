import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CAPTION_STYLES } from "../lib/clips.ts";
import { generateAss, generateTimedCueAss, captionAppearance } from "../lib/captions.ts";
import { activeWordScale, hasFixedPalette, isOneWordStyle, wordLook } from "../lib/caption-looks.ts";

const bs = String.fromCharCode(92);
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");
const words = [["have", 0], ["been", 300], ["possible", 600], ["unless", 900]].map(([text, start]) => ({ text, start, end: start + 280 }));
const res = { w: 1080, h: 1920 };
const lines = (ass) => ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
const body = (line) => line.split(",,").pop();
const GREEN = "&H0014FF39&", WHITE = "&H00FFFFFF&";

test("Focus is a style with its own palette", () => {
  assert.ok(CAPTION_STYLES.includes("FOCUS"));
  assert.ok(hasFixedPalette("FOCUS"));
  assert.equal(wordLook("FOCUS", 2, true).css, "#39FF14");
  assert.equal(wordLook("FOCUS", 2, false).css, "#FFFFFF");
  assert.equal(activeWordScale("FOCUS"), 1.25);
  assert.equal(activeWordScale("TRICOLOR"), 1);
});

test("Focus shows one word at a time, like Klyp, Spark and Pop", () => {
  assert.ok(isOneWordStyle("FOCUS"));
  assert.ok(isOneWordStyle("KLYP") && isOneWordStyle("POP") && isOneWordStyle("SPARK"));
  assert.ok(!isOneWordStyle("TRICOLOR") && !isOneWordStyle("HYPE") && !isOneWordStyle("BOLD"));
});

test("the export draws each word on its own, neon green and 25% larger", () => {
  const ass = generateAss(words, 0, 1600, "FOCUS", res, 0, true);
  const out = lines(ass);
  assert.equal(out.length, 4, "one caption per word");
  assert.deepEqual(out.map(body), ["HAVE", "BEEN", "POSSIBLE", "UNLESS"].map((w) => `{${bs}c${GREEN}${bs}fscx125${bs}fscy125}${w}{${bs}c${WHITE}${bs}fscx100${bs}fscy100}`));
  assert.ok(!ass.includes(`${bs}N`), "no second line");
  assert.match(ass, /Style: Default,Poppins ExtraBold,62,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,6,3,/);
  assert.ok(!ass.includes("Noto Emoji"));
});

test("other highlight styles are unchanged: no size tags", () => {
  assert.ok(!generateAss(words, 0, 1600, "HYPE", res).includes("fscx125"));
  assert.ok(!generateAss(words, 0, 1600, "TRICOLOR", res).includes("fscx125"));
});

test("the editor export draws Focus the same way, one word per caption", () => {
  const appearance = captionAppearance({ caption_color: "white", caption_position: "bottom" });
  const ass = generateTimedCueAss([{ id: "a", start_ms: 0, end_ms: 1200, text: "have been possible unless" }], "FOCUS", appearance, res);
  const out = lines(ass);
  assert.ok(out.some((l) => body(l).includes(`{${bs}c${GREEN}${bs}fscx125${bs}fscy125}POSSIBLE`)));
});

test("the picker and settings list Focus", () => {
  assert.ok(read("components/CaptionTemplatePicker.tsx").includes("name: 'Focus'"));
  assert.ok(read("components/CaptionTemplatePicker.tsx").includes("<em>SECOND</em>"));
  assert.ok(read("app/(dashboard)/dashboard/settings/page.tsx").includes("FOCUS:"));
  assert.ok(read("lib/caption-preview.ts").includes("activeWordScale"));
});
