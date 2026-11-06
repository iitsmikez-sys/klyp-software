import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bestMomentsText } from "../lib/clip-expectation.ts";
import { discoveryPoolSize } from "../lib/discovery-pool.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");

test("the wording names the ceiling, 'Best moments, up to 10'", () => {
  assert.equal(bestMomentsText(10), "Best moments, up to 10");
});

test("the screen never shrinks the number by video length and never states a plain clip count", () => {
  const src = read("components/AnalyzePanel.tsx");
  assert.doesNotMatch(src, />\{clipCount\} clips ·/);
  assert.doesNotMatch(src, /expectedClipCeiling|shownClips|upToClipsText/);
  assert.match(src, /bestMomentsText\(clipCount\)/);
  assert.match(src, /Finds your best moments, up to \{clipCount\}/);
});

test("the request to the clip finder is the same for a 15 minute video as for a 5 hour one", () => {
  const pipeline = read("lib/analyze-pipeline.ts");
  // the finder is told to look for the top clipCount, and nothing scales that number by the video's length
  assert.ok(pipeline.includes("Find up to ${clipCount} clippable moments"));
  assert.ok(pipeline.includes("return the TOP ${clipCount} by viral_score"));
  assert.ok(pipeline.includes("deduped.filter(clip => clip.viral_score >= 65).slice(0, clipCount)"));
  assert.doesNotMatch(pipeline, /durationSeconds\s*\/\s*\d+[^\n]*clipCount|clipCount[^\n]*durationSeconds\s*\/\s*\d+/);
  assert.equal(discoveryPoolSize(10), 10);
  // the analyze route passes the requested count straight through
  assert.doesNotMatch(read("app/api/analyze/route.ts"), /expectedClipCeiling|MINUTES_PER_CLIP/);
});
