import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SPARK_PACKS, packSavingsPercent, packToCover } from "../lib/spark-packs.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");

test("pack savings are whole percents against the smallest pack, rounded down so a discount is never overstated", () => {
  assert.deepEqual(SPARK_PACKS.map(packSavingsPercent), [0, 10, 17]);
});

test("the pop-up pre-selects the smallest pack that covers what the person is short", () => {
  assert.equal(packToCover(10).id, "p100");
  assert.equal(packToCover(100).id, "p100");
  assert.equal(packToCover(101).id, "p250");
  assert.equal(packToCover(400).id, "p500");
  assert.equal(packToCover(9999).id, "p500");
});

test("with a pasted video the pop-up shows it, what it costs, and exactly how many more Sparks are needed", () => {
  const dialog = read("components/OutOfSparksDialog.tsx");
  assert.ok(dialog.includes("Your clips are almost ready") && dialog.includes("data-pending-video"));
  assert.ok(dialog.includes("costs {video.cost} Sparks") && dialog.includes("You need {shortfall} more"));
  assert.ok(dialog.includes("Math.max(0, video.cost - balance)") && dialog.includes("packToCover(shortfall)"));
  assert.doesNotMatch(dialog, /needs \{video/);
  const panel = read("components/AnalyzePanel.tsx");
  assert.ok(panel.includes("video={inputMode === \"url\" && previewDuration !== null && totalEstimate !== null"));
  assert.ok(panel.includes("cost: totalEstimate"));
});

test("running low no longer locks the link box: they can paste a VOD, and only Find Clips opens the pack pop-up", () => {
  const panel = read("components/AnalyzePanel.tsx");
  assert.ok(panel.includes("<OutOfSparksDialog isPro={isPro}"));
  // the link box is only locked while analyzing; clicking or pasting into it never opens the pop-up
  assert.ok(panel.includes('aria-label="VOD URL"'));
  assert.ok(!panel.includes("onFocus={() => { if (outOfSparks)"));
  // Find Clips stays clickable when out of Sparks and opens the pop-up instead of analyzing
  assert.ok(panel.includes("disabled={!canSubmit && !outOfSparks}"));
  assert.ok(panel.includes("if (outOfSparks) { setSparksDialog(true); return; }"));
  assert.ok(!panel.includes("disabled={loading || outOfSparks}"));
});

test("the pop-up sells the one-time packs first, Pro second, and starts the same pack checkout as the Upgrade page", () => {
  const dialog = read("components/OutOfSparksDialog.tsx");
  assert.ok(dialog.includes("You're out of Sparks") && dialog.includes("No subscription needed"));
  assert.ok(dialog.includes('fetch("/api/stripe/packs"') && dialog.includes("JSON.stringify({ pack: packId })"));
  assert.ok(dialog.includes("SPARK_PACKS.map") && dialog.includes("packSavingsPercent"));
  assert.ok(dialog.includes("{!isPro && (") && dialog.includes("More Sparks every month, more benefits, no watermark"));
  assert.ok(dialog.includes('aria-label="Close"') && dialog.includes('e.key === "Escape"'));
  assert.doesNotMatch(dialog, /Maybe later|come back in|each<|[$]0[.][0-9]+ each/);
  assert.doesNotMatch(dialog, /¢|cents? each|each\b.*Spark/i);
});

test("someone with a few Sparks, but fewer than the cheapest video, is told the real reason", () => {
  const dialog = read("components/OutOfSparksDialog.tsx");
  assert.ok(dialog.includes("You need more Sparks") && dialog.includes("a video starts at ${MIN_ANALYZE_COST}"));
  const panel = read("components/AnalyzePanel.tsx");
  assert.ok(panel.includes("balance={balance}") && panel.includes("balance > 0 ?"));
});
