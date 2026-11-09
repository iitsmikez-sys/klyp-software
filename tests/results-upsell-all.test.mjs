import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PLAN_LIMITS } from "../lib/plan-limits.ts";
import { RESULTS_KEPT_DAYS } from "../lib/results-retention.ts";
import { CAPTION_STYLES, FREE_CAPTION_STYLES } from "../lib/clips.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");

test("the box says only things the app's own rules say, and promises no clip count or unlimited", () => {
  const box = read("components/ResultsUpsell.tsx");
  for (const piece of ["CAPTION_STYLES.length - FREE_CAPTION_STYLES.length", "resultsKeptDays(true)", "resultsKeptDays(false)", "PLAN_LIMITS.pro.youtube / 3600", "PLAN_LIMITS.free.youtube / 3600", "MONTHLY_PRICE_USD", "No Klyp watermark on your downloads"]) {
    assert.ok(box.includes(piece), piece);
  }
  assert.doesNotMatch(box, /unlimited|∞|infinite|up to \d+ clips|\$17/i);
  // The numbers those lines print today.
  assert.equal(CAPTION_STYLES.length - FREE_CAPTION_STYLES.length, 13);
  assert.equal(PLAN_LIMITS.pro.youtube / 3600, 8);
  assert.equal(PLAN_LIMITS.free.youtube / 3600, 2);
  assert.deepEqual({ ...RESULTS_KEPT_DAYS }, { free: 5, pro: 30 });
});

test("the title counts the clips honestly and reads right for one clip", () => {
  const box = read("components/ResultsUpsell.tsx");
  assert.ok(box.includes('clipCount === 1 ? "this clip" : `these ${clipCount} clips`'));
  assert.ok(box.includes('clipCount === 1 ? "it" : "them"'));
});

test("it shows under every free run that is not a best-2-hours run, never to Pro, and only counts clips that were not discarded", () => {
  const panel = read("components/AnalyzePanel.tsx");
  assert.ok(panel.includes('import ResultsUpsell from "@/components/ResultsUpsell";'));
  assert.ok(panel.includes('{partRunTotal === null && !isPro && clips.some((_, i) => clipStatus[i] !== "discarded") && ('));
  assert.ok(panel.includes('<ResultsUpsell clipCount={clips.filter((_, i) => clipStatus[i] !== "discarded").length} />'));
  assert.ok(panel.indexOf("<ResultsUpsell") > panel.indexOf("clips.map((clip, i) =>"), "after the clips");
  assert.ok(panel.includes("{partRunTotal !== null && !isPro && clips.length > 0 && <PartUpsell"), "the long-video box is untouched");
});

test("views and clicks are counted, and tell the two boxes apart", () => {
  const box = read("components/ResultsUpsell.tsx");
  assert.ok(box.includes('trackEvent("results_upsell_view", { kind: "normal" })'));
  assert.ok(box.includes('trackEvent("results_upsell_click", { kind: "normal" })'));
});
