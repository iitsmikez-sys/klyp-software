import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FREE_PART_SECONDS, PLAN_LIMITS, checkSourceLimit } from "../lib/plan-limits.ts";
import { estimateSparks } from "../lib/sparks.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");

test("the free first part fits inside the Free limit and costs no more than the 60 free Sparks", () => {
  assert.equal(FREE_PART_SECONDS, 7140);
  assert.ok(FREE_PART_SECONDS <= PLAN_LIMITS.free.youtube);
  assert.equal(checkSourceLimit("free", "youtube", FREE_PART_SECONDS).ok, true);
  assert.equal(estimateSparks(FREE_PART_SECONDS), 50);
  assert.ok(estimateSparks(FREE_PART_SECONDS) <= 60, "a Free account can afford it");
  assert.equal(checkSourceLimit("free", "youtube", 5.5 * 3600).ok, false, "the whole 5.5 hour video is still refused");
});

test("the server only honours it for a Free account over the limit, and charges for the part", () => {
  const route = read("app/api/analyze/route.ts");
  assert.ok(route.includes("firstPartOnly = body.firstPartOnly === true;"));
  assert.ok(route.includes('firstPartOnly && plan === "free" && !uploadedPath && !fullLengthCheck.ok && fullLengthCheck.status === 413'));
  for (const piece of ["durationSeconds: analysisSeconds,", "clipCountForDuration(analysisSeconds)", "estimateSparks(analysisSeconds)", "durationHint = analysisSeconds;", "plan, analysisSeconds);"]) {
    assert.ok(route.includes(piece), piece);
  }
  assert.ok(route.includes("useDiscoveryV2 || partSeconds ? null"), "a saved full transcript is never reused for a part");
  assert.ok(route.includes("partSeconds,\n              clipCount,"), "passed to the pipeline");
});

test("the pipeline cuts the audio to the part and never records that transcript as full coverage", () => {
  const pipeline = read("lib/analyze-pipeline.ts");
  assert.ok(pipeline.includes("trimAudioToPart(full, workDir, partSeconds)"));
  assert.ok(pipeline.includes('["-y", "-i", audioPath, "-t", String(seconds), "-vn", "-c", "copy", outPath]'));
  assert.ok(pipeline.includes('(windows.length || partSeconds ? "chat-sampled" : "full")'));
});

test("the pop-up offers the free first part and the screen then prices and sends just that part", () => {
  const panel = read("components/AnalyzePanel.tsx");
  assert.ok(panel.includes("const firstPart = firstPartFor === url && !!planBlock && !isPro;"));
  assert.ok(panel.includes("estimateSparks(FREE_PART_SECONDS)"));
  assert.ok(panel.includes("firstPartOnly: firstPart || undefined"));
  assert.ok(panel.includes("(!planBlock || firstPart)"));
  assert.ok(panel.includes('trackEvent("long_video_first_part"'));
});
