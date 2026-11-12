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
  assert.match(src, /Finds your best moments, up to \{shownClipCount\}, best first\. Some may be weaker\. Included in the price\./);
  assert.doesNotMatch(src, /Only moments worth posting are returned/, "no longer true: weaker moments now fill the list");
  assert.match(src, /clipCountForDuration\(/);
});

test("longer videos look for more clips: 15 up to 2 hours, 20 beyond (20 is the most the database takes)", async () => {
  const { clipCountForDuration } = await import("../lib/sparks.ts");
  assert.equal(clipCountForDuration(15 * 60), 15);
  assert.equal(clipCountForDuration(2 * 3600), 15);
  assert.equal(clipCountForDuration(2 * 3600 + 1), 20);
  assert.equal(clipCountForDuration(8 * 3600), 20);
  assert.equal(clipCountForDuration(24 * 3600), 20, "never more than 20");
  assert.equal(clipCountForDuration(Number.NaN), 15);
  assert.equal(clipCountForDuration(0), 15);
});

test("the analyze route sets the count from the verified length, and the finder is asked for the top clipCount", () => {
  const pipeline = read("lib/analyze-pipeline.ts");
  assert.ok(pipeline.includes("Find up to ${clipCount} clippable moments"));
  assert.ok(pipeline.includes("return the TOP ${clipCount} by viral_score"));
  assert.ok(pipeline.includes("deduped.filter(clip => clip.viral_score >= 65).slice(0, clipCount)"));
  assert.ok(pipeline.includes("max_tokens: clipCount > 15 ? 24000 : clipCount > 10 ? 20000 : 16000,"));
  const route = read("app/api/analyze/route.ts");
  assert.match(route, /clipCount = clipCountForDuration\(analysisSeconds\);/);
  assert.ok(route.indexOf("clipCount = clipCountForDuration(analysisSeconds)") < route.indexOf("const upfrontCost"));
  assert.equal(discoveryPoolSize(10), 10);
  assert.equal(discoveryPoolSize(12), 20);
  assert.equal(discoveryPoolSize(15), 20);
});

test("the database never sees a count it rejects: 15 is sent as the next value it accepts", () => {
  const jobs = read("lib/analysis-jobs.ts");
  assert.match(jobs, /DB_REQUESTED_CLIP_VALUES = \[1, 2, 3, 5, 7, 10, 12, 20\]/);
  assert.match(jobs, /DB_REQUESTED_CLIP_VALUES\.find\(\(value\) => value >= clipCount\) \?\? 20/);
  for (const n of [10, 12, 15]) assert.ok([1, 2, 3, 5, 7, 10, 12, 20].find((v) => v >= n) >= n);
});

test("the prompt looks for stories with a payoff on purpose and judges them on hook and payoff, not hype or skill", () => {
  const pipeline = read("lib/analyze-pipeline.ts");
  assert.match(pipeline, /STORIES ARE NOT FLAT TALKING/);
  assert.match(pipeline, /hook \(does the first line make a stranger stop\?\)/);
  assert.match(pipeline, /Do NOT mark it down for lacking hype or skill/);
  assert.match(pipeline, /A story with no payoff, or one that needs a paragraph of context, still does not clip/);
});
