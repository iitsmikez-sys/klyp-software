import test from "node:test";
import assert from "node:assert/strict";
import { planVisualChecks, applyVisualCheck } from "../lib/vision-plan.ts";

const clips = Array.from({ length: 5 }, (_, i) => ({ start_seconds: i * 100, end_seconds: i * 100 + 30, thumbnail_seconds: i * 100 + 15, viral_score: 80, reason: "reaction" }));
test("vision is capped to two finalists and one frame each", () => {
  const plan = planVisualChecks(clips);
  assert.equal(plan.length, 2);
  assert.deepEqual(plan.map((p) => p.frameSecond), [15, 115]);
});
test("visual adjustment is bounded and cannot rescue low-quality picks", () => {
  assert.equal(applyVisualCheck({ ...clips[0], viral_score: 64 }, 5).viral_score, 64);
  assert.equal(applyVisualCheck(clips[0], 100).viral_score, 84);
  assert.equal(applyVisualCheck(clips[0], -100).viral_score, 76);
});
