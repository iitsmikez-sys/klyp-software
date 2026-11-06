import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bestMomentsText } from "../lib/clip-expectation.ts";
import { discoveryPoolSize } from "../lib/discovery-pool.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");

test("the wording names the ceiling, 'Best moments, up to 10'", () => {
  assert.equal(bestMomentsText(10), "Best moments, up to 10");
});

test("the screen names the ceiling for this video's length and never states a plain clip count", () => {
  const src = read("components/AnalyzePanel.tsx");
  assert.doesNotMatch(src, />\{clipCount\} clips ·/);
  assert.doesNotMatch(src, /expectedClipCeiling|shownClips|upToClipsText/);
  assert.match(src, /bestMomentsText\(shownClipCount\)/);
  assert.match(src, /Finds your best moments, up to \{shownClipCount\}/);
  assert.match(src, /clipCountForDuration\(/);
});

test("longer videos look for more clips: 10 up to 2 hours, 12 up to 4 hours, 20 beyond", async () => {
  const { clipCountForDuration } = await import("../lib/sparks.ts");
  assert.equal(clipCountForDuration(15 * 60), 10);
  assert.equal(clipCountForDuration(2 * 3600), 10);
  assert.equal(clipCountForDuration(2 * 3600 + 1), 12);
  assert.equal(clipCountForDuration(4 * 3600), 12);
  assert.equal(clipCountForDuration(4 * 3600 + 1), 20);
  assert.equal(clipCountForDuration(8 * 3600), 20);
  assert.equal(clipCountForDuration(Number.NaN), 10);
  assert.equal(clipCountForDuration(0), 10);
});

test("the analyze route sets the count from the verified length, and the finder is asked for the top clipCount", () => {
  const pipeline = read("lib/analyze-pipeline.ts");
  assert.ok(pipeline.includes("Find up to ${clipCount} clippable moments"));
  assert.ok(pipeline.includes("return the TOP ${clipCount} by viral_score"));
  assert.ok(pipeline.includes("deduped.filter(clip => clip.viral_score >= 65).slice(0, clipCount)"));
  assert.match(pipeline, /max_tokens: clipCount > 10 \? 20000 : 16000/);
  const route = read("app/api/analyze/route.ts");
  assert.match(route, /clipCount = clipCountForDuration\(verifiedDuration\);/);
  assert.ok(route.indexOf("clipCount = clipCountForDuration(verifiedDuration)") < route.indexOf("const upfrontCost"));
  assert.equal(discoveryPoolSize(10), 10);
  assert.equal(discoveryPoolSize(12), 20);
  assert.equal(discoveryPoolSize(20), 20);
});

test("the prompt looks for stories with a payoff on purpose and judges them on hook and payoff, not hype or skill", () => {
  const pipeline = read("lib/analyze-pipeline.ts");
  assert.match(pipeline, /STORIES ARE NOT FLAT TALKING/);
  assert.match(pipeline, /hook \(does the first line make a stranger stop\?\)/);
  assert.match(pipeline, /Do NOT mark it down for lacking hype or skill/);
  assert.match(pipeline, /A story with no payoff, or one that needs a paragraph of context, still does not clip/);
});
