import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");
const pipeline = read("lib/analyze-pipeline.ts");

test("gaming runs get a roleplay and dialogue section; other runs do not", () => {
  assert.match(pipeline, /const roleplaySection = contentType === "gaming"/);
  assert.match(pipeline, /\$\{loudSection\}\$\{roleplaySection\}\$\{languageNote\}/);
  assert.match(pipeline, /ROLEPLAY AND DIALOGUE-DRIVEN GAMING/);
  assert.match(pipeline, /the clip is what is SAID, not what is played/);
});

test("it credits catchphrases, confessions, misunderstandings, roasts and boasts", () => {
  for (const kind of [/quotable catchphrase or comeback/, /in-character confession/, /funny misunderstanding/, /ironic mini-story/, /roast or clapback/, /deadpan one-liner/, /confident boast/]) {
    assert.match(pipeline, kind);
  }
});

test("in-world names and slang are part of the appeal and never a reason to mark a clip down on their own", () => {
  assert.match(pipeline, /never mark a clip down for needing roleplay knowledge/);
  assert.match(pipeline, /Hype and skill can honestly be near zero/);
});

test("slurs and platform-flagged words never go into a title, hook, caption or reason", () => {
  assert.match(pipeline, /Never put a slur or other hateful or platform-flagged word in a title, hook, caption or reason/);
});

test("roleplay results are cached apart from older gaming results", () => {
  assert.match(pipeline, /contentType === "gaming" \? "rp-v1" : ""/);
});
