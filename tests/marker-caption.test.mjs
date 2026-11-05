import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CAPTION_STYLES, isProCaptionStyle } from "../lib/clips.ts";
import { generateAss, generateTimedCueAss, captionAppearance } from "../lib/captions.ts";
import { captionEmPx, captionTextWidthPx } from "../lib/caption-text-metrics.ts";
import { MARKER_BOX, hasFixedPalette, isHighlightStyle, isOneWordStyle, wordLook } from "../lib/caption-looks.ts";

const bs = String.fromCharCode(92);
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");
const res = { w: 1080, h: 1920 };
const lines = (ass) => ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
const layerOf = (l) => Number(l.split(":")[1].split(",")[0].trim());
const isBox = (l) => l.includes(`${bs}p1`);
const boxPos = (l) => { const m = /\pos\((-?\d+),(-?\d+)\)/.exec(l); return { x: Number(m[1]), y: Number(m[2]) }; };
const drawing = (l) => /\}m (\d+) 0 l (\d+) 0/.exec(l);

test("Marker is a Pro phrase style with a fixed look: white text, purple box", () => {
  assert.ok(CAPTION_STYLES.includes("MARKER"));
  assert.ok(isProCaptionStyle("MARKER"));
  assert.ok(isHighlightStyle("MARKER") && hasFixedPalette("MARKER"));
  assert.ok(!isOneWordStyle("MARKER"), "the whole phrase stays on screen");
  assert.equal(wordLook("MARKER", 1, true).css, "#FFFFFF");
  assert.deepEqual({ ...MARKER_BOX }, { css: "#7C4DFF", ass: "&H00FF4D7C&" });
});

test("letter widths match what libass really draws (measured), for all three fonts", () => {
  // Measured with libass at PlayRes 1080x1920: "WARNING PLAY" is about 443px of ink at size 100 in Poppins ExtraBold.
  const sans = captionTextWidthPx("WARNING PLAY", 100, "sans");
  assert.ok(sans > 435 && sans < 465, String(sans));
  assert.ok(captionTextWidthPx("Can you daddy?", 62, "sans") > 280 && captionTextWidthPx("Can you daddy?", 62, "sans") < 330);
  assert.ok(captionTextWidthPx("iiii", 80) < captionTextWidthPx("WWWW", 80));
  assert.ok(captionTextWidthPx("hello", 80, "serif") > 0 && captionTextWidthPx("hello", 80, "mono") > captionTextWidthPx("hello", 80, "serif"));
  assert.equal(captionTextWidthPx("", 80), 0);
  assert.ok(captionEmPx(100) > 50 && captionEmPx(100) < 65);
});

test("the export puts a purple box behind each word in turn, on a lower layer than the text", () => {
  const app = captionAppearance({ caption_color: "white", caption_position: "bottom" });
  const ass = generateTimedCueAss([{ id: "a", start_ms: 0, end_ms: 1500, text: "Can you daddy?" }], "MARKER", app, res);
  const out = lines(ass);
  assert.equal(out.length, 6, "a box and a text line for each of the three words");
  const boxes = out.filter(isBox), texts = out.filter((l) => !isBox(l));
  assert.equal(boxes.length, 3);
  boxes.forEach((l) => { assert.equal(layerOf(l), 0); assert.ok(l.includes(MARKER_BOX.ass)); });
  texts.forEach((l) => { assert.equal(layerOf(l), 1); assert.ok(l.includes("Can") && l.includes("daddy?")); });
  // The box moves left to right as the words are said, and each box is as wide as its word plus padding.
  const xs = boxes.map((l) => boxPos(l).x);
  assert.ok(xs[0] < xs[1] && xs[1] < xs[2], xs.join(","));
  const widths = boxes.map((l) => Number(drawing(l)[2]) + Number(drawing(l)[1]));
  assert.ok(widths[1] < widths[0] + 60 && widths[0] > 60);
  // The text is not recolored or resized: Marker only adds the box.
  assert.ok(!texts[0].includes("fscx"));
  // Case is kept as typed (not forced to capitals).
  assert.ok(texts[0].includes("Can") && !texts[0].includes("CAN"));
});

test("on a two-line caption the box goes on the line that has the word", () => {
  const app = captionAppearance({ caption_color: "white", caption_position: "bottom" });
  const ass = generateTimedCueAss([{ id: "b", start_ms: 0, end_ms: 4000, text: "AND, UM, COPS GOT their stuff" }], "MARKER", app, res);
  const out = lines(ass);
  const boxes = out.filter(isBox);
  assert.equal(boxes.length, 6);
  const ys = boxes.map((l) => boxPos(l).y);
  assert.ok(new Set(ys).size === 2, "boxes on two different lines");
  assert.ok(ys[0] < ys[5], "first words sit on the upper line, last words on the lower line");
});

test("the plain export path (non-editor) draws Marker too", () => {
  const words = ["can", "you", "daddy"].map((text, i) => ({ text, start: i * 400, end: i * 400 + 350 }));
  const ass = generateAss(words, 0, 1500, "MARKER", res, 0, true);
  assert.ok(lines(ass).some(isBox));
  assert.ok(ass.includes("Style: Default,Poppins ExtraBold,82"));
});

test("the picker, settings, previews and preview painter know about Marker", () => {
  assert.ok(read("components/CaptionTemplatePicker.tsx").includes("name: 'Marker'"));
  assert.ok(read("components/CaptionTemplatePicker.tsx").includes("'DUO', 'MARKER'"));
  assert.ok(read("app/(dashboard)/dashboard/settings/page.tsx").includes("MARKER:"));
  assert.ok(read("components/ClipPreview.tsx").includes("MARKER:"));
  const preview = read("lib/caption-preview.ts");
  assert.ok(preview.includes("paintMarkerBox(ctx, widths[index])") && preview.includes("MARKER_BOX.css"));
});
