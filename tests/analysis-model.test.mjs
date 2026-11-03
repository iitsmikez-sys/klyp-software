import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analysisModelFor, FREE_ANALYSIS_MODEL, PRO_ANALYSIS_MODEL } from "../lib/plan-limits.ts";
import { resultCacheKey } from "../lib/analysis-result-cache.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");

test("Free analyses use Sonnet 5.5 and Pro keeps Opus 4.8", () => {
  assert.equal(FREE_ANALYSIS_MODEL, "claude-sonnet-5-5");
  assert.equal(PRO_ANALYSIS_MODEL, "claude-opus-4-8");
  assert.equal(analysisModelFor(false, {}), "claude-sonnet-5-5");
  assert.equal(analysisModelFor(true, {}), "claude-opus-4-8");
});

test("each side can be changed with a setting, but only to a known model", () => {
  assert.equal(analysisModelFor(false, { FREE_ANALYSIS_MODEL: "claude-opus-4-8" }), "claude-opus-4-8");
  assert.equal(analysisModelFor(true, { PRO_ANALYSIS_MODEL: " claude-sonnet-5-5 " }), "claude-sonnet-5-5");
  assert.equal(analysisModelFor(false, { FREE_ANALYSIS_MODEL: "gpt-4" }), "claude-sonnet-5-5", "an unknown value is ignored");
  assert.equal(analysisModelFor(true, { FREE_ANALYSIS_MODEL: "claude-opus-5-5" }), "claude-opus-4-8", "the Free setting never changes Pro");
});

test("cached results keep their old key for Opus 4.8, and a different model gets its own", () => {
  const input = { sourceKey: "youtube:abc", durationSeconds: 600, contentType: "gaming", keyword: "", creatorPreferences: "", windows: [{ start: 0, end: 600 }] };
  const before = resultCacheKey(input);
  assert.equal(resultCacheKey({ ...input, model: undefined }), before);
  assert.notEqual(resultCacheKey({ ...input, model: "claude-sonnet-5-5" }), before);
});

test("the analyze route picks the model by plan, and the picker defaults to Opus 4.8 when nobody asks", () => {
  assert.ok(read("app/api/analyze/route.ts").includes('model: analysisModelFor(plan === "pro"),'));
  const pipeline = read("lib/analyze-pipeline.ts");
  assert.ok(pipeline.includes('model: string = "claude-opus-4-8"'));
  assert.ok(!pipeline.includes('model: "claude-opus-4-8",\n    max_tokens'), "no hard-coded model left in the request");
  assert.ok(read("lib/vod-discovery-pipeline.ts").includes("runId, windows, opts.model);"));
  const rates = read("lib/provider-budget-core.ts");
  assert.ok(rates.includes("'claude-sonnet-5-5': { input: 2, output: 10 }") && rates.includes("'claude-opus-5-5': { input: 4, output: 20 }"));
});
