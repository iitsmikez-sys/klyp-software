import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { detectContentFromTranscript, gamingDensity, GAMING_DENSITY_MIN, detectContentType } from "../lib/detect-content-type.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");
const filler = "so yesterday my friend told me a story about her mom and the weather and i could not stop laughing at all ".repeat(1);
const talk = (n) => filler.repeat(Math.ceil(n / 20));
const game = (n) => "he is low push the enemy squad reload the shotgun clutch the round ranked lobby respawn ".repeat(Math.ceil(n / 14));

test("a talking stream reads as IRL and a game stream reads as Gaming", () => {
  assert.equal(detectContentFromTranscript(talk(2000)), "irl");
  assert.equal(detectContentFromTranscript(game(2000)), "gaming");
});

test("too little speech to tell keeps the default", () => {
  assert.equal(detectContentFromTranscript(talk(100)), null);
  assert.equal(detectContentFromTranscript(""), null);
});

test("the cut-off sits between talk and game", () => {
  assert.ok(gamingDensity(talk(2000)) < GAMING_DENSITY_MIN);
  assert.ok(gamingDensity(game(2000)) > GAMING_DENSITY_MIN);
});

test("a title that names the content still wins, and a title with no hint is still unknown", () => {
  assert.equal(detectContentType("GTA RP night"), "gaming");
  assert.equal(detectContentType("chill chewsdays | !socials | !discord 2026-11-18"), null);
});

test("Auto with an unclear title is sent to the server and decided from the transcript; a pinned or detected choice is not", () => {
  const panel = read("components/AnalyzePanel.tsx");
  assert.ok(panel.includes('contentChoice === "auto" && !detectedContent ? { contentAuto: true } : {}'));
  const route = read("app/api/analyze/route.ts");
  assert.ok(route.includes("autoContentType = body.contentAuto === true;"));
  assert.ok(route.includes("autoContentType,"));
  const pipeline = read("lib/analyze-pipeline.ts");
  assert.ok(pipeline.includes("if (opts.autoContentType && !nonEnglish) {"), "not guessed for non-English speech");
  assert.ok(pipeline.includes("let contentType = opts.contentType ?? DEFAULT_CONTENT_TYPE;"));
});
