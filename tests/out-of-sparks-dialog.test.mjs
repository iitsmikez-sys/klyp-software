import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SPARK_PACKS, packSavingsPercent } from "../lib/spark-packs.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");

test("pack savings are whole percents against the smallest pack, never cents", () => {
  assert.deepEqual(SPARK_PACKS.map(packSavingsPercent), [0, 10, 18]);
});

test("running out of Sparks no longer locks the link box: trying to use it opens the pack pop-up", () => {
  const panel = read("components/AnalyzePanel.tsx");
  assert.ok(panel.includes("<OutOfSparksDialog isPro={isPro}"));
  // the link box is only locked while analyzing, and focusing it while out of Sparks opens the pop-up
  assert.ok(panel.includes("disabled={loading}\n                onFocus={() => { if (outOfSparks) setSparksDialog(true); }}"));
  // Find Clips stays clickable when out of Sparks and opens the pop-up instead of analyzing
  assert.ok(panel.includes("disabled={!canSubmit && !outOfSparks}"));
  assert.ok(panel.includes("if (outOfSparks) { setSparksDialog(true); return; }"));
  assert.ok(!panel.includes("disabled={loading || outOfSparks}"));
});

test("the pop-up sells the one-time packs first, Pro second, and starts the same pack checkout as the Upgrade page", () => {
  const dialog = read("components/OutOfSparksDialog.tsx");
  assert.ok(dialog.includes("You&apos;re out of Sparks") && dialog.includes("No subscription needed"));
  assert.ok(dialog.includes('fetch("/api/stripe/packs"') && dialog.includes("JSON.stringify({ pack: packId })"));
  assert.ok(dialog.includes("SPARK_PACKS.map") && dialog.includes("packSavingsPercent"));
  assert.ok(dialog.includes("{!isPro && (") && dialog.includes("More Sparks every month, more benefits, no watermark"));
  assert.ok(dialog.includes('aria-label="Close"') && dialog.includes('e.key === "Escape"'));
  assert.doesNotMatch(dialog, /Maybe later|come back in|each<|[$]0[.][0-9]+ each/);
  assert.doesNotMatch(dialog, /¢|cents? each|each\b.*Spark/i);
});
