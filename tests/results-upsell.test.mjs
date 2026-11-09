import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { lengthWords } from "../lib/length-words.ts";
import { CAPTION_STYLES, FREE_CAPTION_STYLES } from "../lib/clips.ts";
import { clipCountForDuration } from "../lib/sparks.ts";
import { RESULTS_KEPT_DAYS } from "../lib/results-retention.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");

test("lengths read as plain words", () => {
  assert.equal(lengthWords(17643), "4 hours 54 minutes");
  assert.equal(lengthWords(17643 - 7140), "2 hours 55 minutes");
  assert.equal(lengthWords(3600), "1 hour");
  assert.equal(lengthWords(2700), "45 minutes");
  assert.equal(lengthWords(0), "0 minutes");
});

test("every number in the upgrade box comes from the app's own rules", () => {
  assert.equal(CAPTION_STYLES.length - FREE_CAPTION_STYLES.length, 13, "13 Pro caption styles");
  assert.equal(clipCountForDuration(17643), 15);
  assert.equal(clipCountForDuration(3.2 * 3600), 12);
  assert.deepEqual({ ...RESULTS_KEPT_DAYS }, { free: 5, pro: 30 });
  const box = read("components/PartUpsell.tsx");
  for (const piece of ["clipCountForDuration(totalSeconds)", "CAPTION_STYLES.length - FREE_CAPTION_STYLES.length", "resultsKeptDays(true)", "resultsKeptDays(false)", "MONTHLY_PRICE_USD"]) assert.ok(box.includes(piece), piece);
});

test("the box makes no false promise: no 'unlimited', no price that might not apply", () => {
  const box = read("components/PartUpsell.tsx");
  assert.doesNotMatch(box, /unlimited|∞|infinite/i);
  assert.doesNotMatch(box, /\$17/);
  assert.ok(box.includes('href="/dashboard/upgrade"'));
});

test("it shows only for a free person right after a 'best 2 hours' run, under the clips, with the source line above them", () => {
  const panel = read("components/AnalyzePanel.tsx");
  assert.ok(panel.includes("submittedPartTotal.current = firstPart && previewDuration ? previewDuration : null;"));
  assert.ok(panel.includes("setPartRunTotal(submittedPartTotal.current);"));
  assert.ok(panel.includes("setPartRunTotal(null);"), "cleared when a new analysis starts");
  assert.ok(panel.includes("{partRunTotal !== null && !isPro && clips.length > 0 && <PartUpsell totalSeconds={partRunTotal} analyzedSeconds={FREE_PART_SECONDS} />}"));
  assert.ok(panel.includes("These clips come from the best 2 hours of your stream, which is {lengthWords(partRunTotal)} long."));
  assert.ok(panel.indexOf("<PartUpsell") > panel.indexOf("clips.map((clip, i) =>"), "after the clips");
});

test("showing it and clicking it are counted", () => {
  const box = read("components/PartUpsell.tsx");
  assert.ok(box.includes('trackEvent("results_upsell_view"') && box.includes('trackEvent("results_upsell_click"'));
  assert.match("results_upsell_view", /^[a-z_]{1,40}$/);
  assert.match("results_upsell_click", /^[a-z_]{1,40}$/);
});
