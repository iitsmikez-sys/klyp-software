import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CAPTION_STYLES, FREE_CAPTION_STYLES, isProCaptionStyle, resolveCaptionStyle } from "../lib/clips.ts";
import { generateAss, generateTimedCueAss, captionAppearance } from "../lib/captions.ts";
import { HIGHLIGHTER_YELLOW, MARKER_BOX, boxColorFor, hasFixedPalette, isBoxStyle, isHighlightStyle, isOneWordStyle, isUppercaseStyle, wordLook } from "../lib/caption-looks.ts";
import { READY_CLIP_STYLE, READY_CLIP_HOOK_STYLE } from "../lib/ready-clip.ts";

const bs = String.fromCharCode(92);
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");
const res = { w: 1080, h: 1920 };
const lines = (ass) => ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
const layerOf = (l) => Number(l.split(":")[1].split(",")[0].trim());
const isBoxLine = (l) => l.includes(`${bs}p1`);

test("Highlighter is a free phrase style with a fixed look: white capitals, the spoken word turns yellow, no box", () => {
  assert.ok(CAPTION_STYLES.includes("HIGHLIGHTER"));
  assert.ok(FREE_CAPTION_STYLES.includes("HIGHLIGHTER"));
  assert.equal(isProCaptionStyle("HIGHLIGHTER"), false);
  assert.equal(resolveCaptionStyle("HIGHLIGHTER", false), "HIGHLIGHTER", "a Free account keeps it");
  assert.ok(isHighlightStyle("HIGHLIGHTER") && hasFixedPalette("HIGHLIGHTER"));
  assert.ok(!isBoxStyle("HIGHLIGHTER"), "no box behind the word");
  assert.ok(isBoxStyle("MARKER"));
  assert.ok(!isOneWordStyle("HIGHLIGHTER"), "the whole phrase stays on screen");
  assert.ok(isUppercaseStyle("HIGHLIGHTER"));
  assert.equal(wordLook("HIGHLIGHTER", 1, false).css, "#FFFFFF");
  assert.equal(wordLook("HIGHLIGHTER", 1, true).css, "#FFE14D", "the word being said is yellow");
  assert.deepEqual({ ...HIGHLIGHTER_YELLOW }, { css: "#FFE14D", ass: "&H004DE1FF&" });
  assert.deepEqual(boxColorFor("MARKER"), MARKER_BOX, "Marker keeps its purple");
});

test("the export has no box: one line per word, capitals, the active word yellow and the rest white", () => {
  const app = captionAppearance({ caption_color: "white", caption_position: "bottom" });
  const ass = generateTimedCueAss([{ id: "a", start_ms: 0, end_ms: 1500, text: "Wait, are you guys" }], "HIGHLIGHTER", app, res);
  const out = lines(ass);
  assert.equal(out.filter(isBoxLine).length, 0, "nothing is drawn behind the words");
  assert.equal(out.length, 4);
  assert.ok(out[1].includes("WAIT, {" + bs + "c" + HIGHLIGHTER_YELLOW.ass + "}ARE"), "second word is yellow");
  out.forEach((l) => { assert.ok(l.includes("WAIT,") && l.includes("GUYS"), "capitals"); });
});

test("the style block is bold, white, with a thick black outline", () => {
  const app = captionAppearance({ caption_color: "white", caption_position: "bottom" });
  const ass = generateTimedCueAss([{ id: "a", start_ms: 0, end_ms: 1000, text: "Wait" }], "HIGHLIGHTER", app, res);
  const style = ass.split(String.fromCharCode(10)).find((l) => l.startsWith("Style: Default"));
  assert.ok(style.startsWith("Style: Default,Poppins ExtraBold,84,"));
  const outline = Number(style.split(",")[16]);
  assert.ok(outline >= 6, "a thick outline, got " + outline);
});

test("the plain export path draws Highlighter too", () => {
  const words = ["wait", "are", "you", "guys"].map((text, i) => ({ text, start: i * 400, end: i * 400 + 350 }));
  const ass = generateAss(words, 0, 1700, "HIGHLIGHTER", res, 0, true);
  assert.ok(!lines(ass).some(isBoxLine));
  assert.ok(ass.includes("WAIT") && ass.includes(HIGHLIGHTER_YELLOW.ass));
});

test("Highlighter is the default look for ready-to-post clips, with the white box hook kept", () => {
  assert.equal(READY_CLIP_STYLE, "HIGHLIGHTER");
  assert.equal(READY_CLIP_HOOK_STYLE, "WHITE_BOX");
  assert.ok(CAPTION_STYLES.includes(READY_CLIP_STYLE));
  assert.equal(resolveCaptionStyle(READY_CLIP_STYLE, false), READY_CLIP_STYLE, "free accounts get the default as it is, not Bold");
});

test("the picker, settings, previews and preview painter all know about Highlighter", () => {
  const picker = read("components/CaptionTemplatePicker.tsx");
  assert.ok(picker.includes("name: 'Highlighter'") && picker.includes("'PULSE', 'HIGHLIGHTER', 'HYPE'"));
  assert.ok(picker.includes("style === 'HIGHLIGHTER' ? <>WAIT, <em>ARE</em> YOU GUYS</>"));
  assert.ok(read("components/clip-timeline-editor.css").includes("data-style=highlighter"));
  assert.ok(read("app/(dashboard)/dashboard/settings/page.tsx").includes("HIGHLIGHTER:"));
  assert.ok(read("components/ClipPreview.tsx").includes("HIGHLIGHTER:"));
  const preview = read("lib/caption-preview.ts");
  assert.ok(preview.includes("isBoxStyle(style) && wordOffset + index === activeWord"));
  assert.ok(preview.includes("style === \"HIGHLIGHTER\" ? 84"));
});
