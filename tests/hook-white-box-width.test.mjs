import assert from "node:assert/strict";
import test from "node:test";
import { hookGlyphEm, whiteBoxCardGeometry, wrapCaptionText } from "../lib/captions.ts";

const RES = { w: 1080, h: 1920 };
const FONT_SIZE = 62; // the WHITE_BOX hook size at the 1920px reference
// Real advances (em) of Arial Black, the browser preview font, for the letters in the hooks below.
const ARIAL_BLACK = { A: .778, C: .778, D: .833, E: .722, H: .833, I: .389, J: .667, L: .667, N: .833, O: .833, R: .778, S: .722, T: .722, W: 1, Y: .778, " ": .333 };
const realWidth = (line) => [...line].reduce((sum, ch) => sum + FONT_SIZE * (ARIAL_BLACK[ch] ?? .8), 0);
const card = (lines) => whiteBoxCardGeometry(lines, FONT_SIZE, Math.round(FONT_SIZE * 1.25), RES.w / 2, 100, RES);

for (const hook of ["ALL HE ATE WAS WEENIES", "JASON THE WHALE ROAST", "CHAT LOST IT INSTANTLY"]) {
  test(`white box hugs the text, never narrower than it: "${hook}"`, () => {
    const lines = wrapCaptionText(hook, "BOLD", 18);
    const g = card(lines);
    const widest = Math.max(...lines.map(realWidth));
    assert.ok(g.width >= widest, `card ${g.width}px must be at least as wide as the text ${Math.round(widest)}px`);
    assert.ok(g.width <= widest * 1.25 + 80, `card ${g.width}px should not be much wider than the text ${Math.round(widest)}px`);
  });
}

test("the card is centred on the text so both sides keep padding", () => {
  const lines = ["JASON THE WHALE", "ROAST"];
  const g = card(lines);
  assert.ok(Math.abs(g.x + g.width / 2 - RES.w / 2) <= 1);
  assert.ok(g.width - realWidth(lines[0]) >= 2 * 10, "some padding on each side of the longest line");
});

test("glyph widths: wide letters are wider than narrow ones, and the width never falls below Arial Black's", () => {
  assert.ok(hookGlyphEm("W") > hookGlyphEm("I"));
  assert.ok(hookGlyphEm("M") > hookGlyphEm("L"));
  for (const [ch, em] of Object.entries(ARIAL_BLACK)) if (ch !== " ") assert.ok(hookGlyphEm(ch) >= em, ch);
  assert.ok(hookGlyphEm("?") > 0 && hookGlyphEm("9") > 0 && hookGlyphEm("é") > 0);
});

test("a very long hook still fits inside the frame", () => {
  const g = card(["WWWWWWWWWWWWWWWWWWWW"]);
  assert.ok(g.x >= 4 && g.x + g.width <= RES.w - 4);
});
