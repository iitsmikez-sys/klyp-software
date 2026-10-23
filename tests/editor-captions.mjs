import test from "node:test";
import assert from "node:assert/strict";
import { parseCaptionOptions, parseEditedWords } from "../lib/editor-captions.ts";
import { generateAss } from "../lib/captions.ts";

const original = [
  { text: "Hello", start: 1000, end: 1300 },
  { text: "world", start: 1300, end: 1700 },
];

test("caption options use safe presets", () => {
  assert.deepEqual(parseCaptionOptions({ caption_color: "YELLOW", caption_position: "CENTER" }),
    { color: "YELLOW", position: "CENTER" });
  assert.deepEqual(parseCaptionOptions({ caption_color: "red;foo", caption_position: "12" }),
    { color: "DEFAULT", position: "BOTTOM" });
});

test("caption edits retain the original word timing", () => {
  assert.deepEqual(parseEditedWords([{ text: "Hey", start: 999, end: 999 }, original[1]], original),
    [{ ...original[0], text: "Hey" }, original[1]]);
  assert.throws(() => parseEditedWords([{ text: "x" }], original));
  assert.throws(() => parseEditedWords([{ text: "{".repeat(100) }, original[1]], original));
});

test("ASS export uses edited words, color and position", () => {
  const ass = generateAss([{ ...original[0], text: "Hey" }, original[1]], 0, 3000,
    "BOLD", { w: 1080, h: 1920 }, { color: "YELLOW", position: "CENTER" });
  assert.match(ass, /Hey world/);
  assert.match(ass, /&H0000FFFF/);
  assert.match(ass, /,5,10,10,0,1/);
});
