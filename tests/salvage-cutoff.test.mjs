import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { salvageClipsJson } from "../lib/clip-extras.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");
const clip = (n) => ({ title: `Clip ${n} {with} "quotes" and a } brace`, start_seconds: n * 100, end_seconds: n * 100 + 30, viral_score: 80 - n, reason: "He said \"hello\" \ then left." });

test("an answer cut off inside the near-miss list keeps every main clip", () => {
  const full = JSON.stringify({ clips: [clip(1), clip(2), clip(3)], also_consider: [clip(4), clip(5)] });
  const cut = full.slice(0, full.indexOf('"also_consider"') + 40); // stops inside the second list
  assert.throws(() => JSON.parse(cut));
  const kept = JSON.parse(salvageClipsJson(cut));
  assert.equal(kept.clips.length, 3);
  assert.equal(kept.clips[2].title, clip(3).title, "braces and quotes inside titles do not confuse it");
});

test("an answer cut off in the middle of a clip keeps the clips before it and drops the broken one", () => {
  const full = JSON.stringify({ clips: [clip(1), clip(2), clip(3), clip(4)] });
  const cut = full.slice(0, full.indexOf('"Clip 4') + 25);
  const kept = JSON.parse(salvageClipsJson(cut));
  assert.deepEqual(kept.clips.map((c) => c.start_seconds), [100, 200, 300]);
});

test("nothing complete means nothing is kept, so the run still fails honestly", () => {
  assert.equal(salvageClipsJson('{"clips":[{"title":"half'), null);
  assert.equal(salvageClipsJson("not json at all"), null);
  assert.equal(salvageClipsJson('{"clips":['), null);
});

test("the pipeline only uses it when the output limit was the reason, and otherwise still fails", () => {
  const pipeline = read("lib/analyze-pipeline.ts");
  assert.ok(pipeline.includes('response.stop_reason === "max_tokens" ? salvageClipsJson(text) : null'));
  assert.ok(pipeline.includes('if (!kept) throw new Error("Claude returned output that was not valid JSON.");'));
  assert.ok(pipeline.includes("max_tokens: 16000,"), "still within the cost guard");
});
