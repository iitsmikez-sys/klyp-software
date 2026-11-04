import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { CAPTION_STYLES } from "../lib/clips.ts";
import { generateAss, generateTimedCueAss, captionAppearance } from "../lib/captions.ts";
import { emojiForText, hasFixedPalette, isHighlightStyle, isOneWordStyle } from "../lib/caption-looks.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");
const words = [["the", 0], ["quick", 300], ["brown", 600], ["fire", 900]].map(([text, start]) => ({ text, start, end: start + 280 }));
const res = { w: 1080, h: 1920 };
const lines = (ass) => ass.split("\n").filter((l) => l.startsWith("Dialogue:"));

test("Hype, Pop and Fire are real caption styles", () => {
  for (const style of ["HYPE", "POP", "FIRE"]) assert.ok(CAPTION_STYLES.includes(style), style);
  assert.ok(isHighlightStyle("HYPE") && isHighlightStyle("FIRE") && isHighlightStyle("KEYWORD") && !isHighlightStyle("POP"));
  assert.ok(isOneWordStyle("POP") && !isOneWordStyle("HYPE"));
  assert.ok(hasFixedPalette("HYPE") && hasFixedPalette("FIRE") && !hasFixedPalette("POP"));
});

test("Hype: capitals, white line, the word being said is red", () => {
  const out = lines(generateAss(words, 0, 1500, "HYPE", res));
  assert.ok(out.length >= 4);
  assert.ok(out[0].includes("{\\c&H002D2DFF&}THE"), out[0]);
  assert.ok(out.every((l) => !/[a-z]{3}/.test(l.split(",,").pop().replace(/\{[^}]*\}/g, ""))), "all capitals");
  assert.match(generateAss(words, 0, 1500, "HYPE", res), /Style: Default,Poppins ExtraBold,82,&H00FFFFFF/);
});

test("Pop: one huge uppercase word at a time, yellow unless light blue or white is picked", () => {
  const ass = generateAss(words, 0, 1500, "POP", res);
  assert.equal(lines(ass).length, 4);
  assert.ok(lines(ass)[1].endsWith("QUICK"));
  assert.match(ass, /Style: Default,Poppins ExtraBold,120,&H004AE9FF,/);
  assert.match(generateAss(words, 0, 1500, "POP", res, 0, false, { color: "BLUE", position: "BOTTOM" }), /,120,&H00FFD65F,/);
  assert.match(generateAss(words, 0, 1500, "POP", res, 0, false, { color: "WHITE", position: "BOTTOM" }), /,120,&H00FFFFFF,/);
  assert.ok(lines(ass)[0].includes("\\fscx70"));
});

test("Fire: neon green word, plus an emoji that matches the words", () => {
  assert.equal(emojiForText("that was fire").char, "🔥");
  assert.equal(emojiForText("he is dead").char, "💀");
  assert.equal(emojiForText("the quick brown"), null);
  const out = lines(generateAss(words, 0, 1500, "FIRE", res));
  // Captions are two words long now, so only the caption that says "fire" ("BROWN FIRE") gets the emoji, on both its steps.
  const withEmoji = out.filter((l) => l.includes("{\\fnNoto Emoji") && l.includes("🔥"));
  assert.equal(withEmoji.length, 2, "emoji on every step of the caption that matches");
  assert.ok(out.slice(0, 2).every((l) => !l.includes("Noto Emoji")), "no emoji on the caption that doesn't match");
  assert.ok(out[0].includes("{\\c&H003AFF39&}THE"), out[0]);
  const plain = lines(generateAss(words.slice(0, 3), 0, 1500, "FIRE", res));
  assert.ok(plain.every((l) => !l.includes("Noto Emoji")), "no emoji when nothing matches");
});

test("the editor export draws the same looks", () => {
  const appearance = captionAppearance({ caption_color: "yellow", caption_position: "bottom" });
  const cue = [{ id: "a", start_ms: 0, end_ms: 1200, text: "that was fire" }];
  const fire = lines(generateTimedCueAss(cue, "FIRE", appearance, res));
  assert.ok(fire.length >= 3 && fire[fire.length - 1].includes("🔥"));
  const pop = generateTimedCueAss([{ ...cue[0], text: "wow" }], "POP", captionAppearance({ caption_color: "blue", caption_position: "bottom" }), res);
  assert.match(pop, /,120,&H00FFD65F,/);
  assert.ok(lines(pop)[0].endsWith("WOW"));
});

test("the emoji font and the new pickers ship", () => {
  assert.ok(existsSync(new URL("../public/fonts/NotoEmoji.ttf", import.meta.url)));
  assert.ok(existsSync(new URL("../public/font-licenses/OFL-NotoEmoji.txt", import.meta.url)));
  assert.ok(read("app/globals.css").includes('font-family: "Noto Emoji"'));
  const picker = read("components/CaptionTemplatePicker.tsx");
  for (const name of ["Hype", "Pop", "Fire"]) assert.ok(picker.includes(`name: '${name}'`), name);
  assert.ok(read("components/EditorInspector.tsx").includes("'yellow', 'blue', 'white'"));
});
