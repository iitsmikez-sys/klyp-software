import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");
const panel = read("components/AnalyzePanel.tsx");

test("the server tells the screen when a step was skipped because a saved transcript was reused", () => {
  assert.ok(read("lib/clips.ts").includes("reused?: boolean"));
  const pipeline = read("lib/analyze-pipeline.ts");
  assert.ok(pipeline.includes('progress("download", "done", undefined, true);'));
  assert.ok(pipeline.includes('progress("transcribe", "done", undefined, true);'));
  assert.ok(read("app/api/analyze/route.ts").includes("...(reused ? { reused: true } : {})"));
});

test("the progress screen says when saved work was reused, and ticks every step in turn", () => {
  assert.ok(panel.includes("Found a saved copy of this video, so no download needed."));
  assert.ok(panel.includes("Reused the saved transcript, so no transcribing needed."));
  assert.ok(panel.includes("setReusedStages({});"), "cleared at the start of every run");
  assert.ok(panel.includes("stepIndex * 0.35"), "reused steps pop their ticks one after another");
  assert.ok(panel.includes("klypTick"));
});

test("the progress screen never guesses the time left and does not strike steps through", () => {
  assert.ok(!panel.includes("remaining`"), "no ≈ N min remaining text");
  assert.ok(!panel.includes("line-through"));
  assert.ok(panel.includes("still working — "), "the honest elapsed time stays");
});

test("the details are safe: minutes only, no dollars, no provider names, no word counts", () => {
  const start = panel.indexOf("const doneNote");
  const block = panel.slice(start, start + 900);
  assert.ok(block.includes("minutes transcribed"));
  assert.doesNotMatch(block, /AssemblyAI|Groq|Anthropic|Claude|\$\d|USD|cents|words/i);
});
