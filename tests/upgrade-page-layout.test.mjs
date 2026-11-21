import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");
const page = read("app/(dashboard)/dashboard/upgrade/page.tsx");

test("the buy button comes before the feature list, so it is on the first screen", () => {
  const button = page.indexOf("onClick={complimentaryPro ? undefined");
  const list = page.indexOf("proFeatures.map(");
  assert.ok(button > 0 && list > 0 && button < list);
});

test("the fine print sits under the button and still says $28 a month, that the pass isn't refunded, and how to cancel", () => {
  const note = page.indexOf("unless you cancel. {trial.sparks} Sparks during the");
  assert.ok(note > page.indexOf("onClick={complimentaryPro ? undefined"));
  assert.ok(page.includes("Card required. The ${trial.priceCents / 100} isn't refunded. Cancel any time from this page."));
  assert.ok(page.includes("${MONTHLY_PRICE_USD}/month unless you cancel"));
});

test("people who are not Pro see five key reasons first, with a link to the rest; Pro members see the full list", () => {
  assert.ok(page.includes("const KEY_FEATURE = /Sparks every|No watermark|Longer videos|Raw exports|Automatic clipping/;"));
  assert.ok(page.includes("isPro || showAllFeatures ? PRO_FEATURES : PRO_FEATURES.filter((f) => KEY_FEATURE.test(f.text))"));
  assert.ok(page.includes("See everything in Pro"));
});

test("the headline follows why the person came (?need=long or ?need=sparks), and the general headline stays the default", () => {
  assert.ok(page.includes('value === "long" || value === "sparks" || value === "live" || value === "unlock" ? value : null'));
  assert.ok(page.includes('"Your video is too long for Free"'));
  assert.ok(page.includes('"You\'re out of Sparks"'));
  assert.ok(page.includes('"Go Pro. Lose the watermark."'));
});

test("the pop-ups send the reason along, and the general results upsell does not", () => {
  const panel = read("components/AnalyzePanel.tsx");
  assert.ok(panel.includes('href="/dashboard/upgrade?need=long"'));
  assert.ok(panel.includes('href="/dashboard/upgrade?need=sparks"'));
  assert.ok(read("components/OutOfSparksDialog.tsx").includes('href="/dashboard/upgrade?need=sparks"'));
  assert.ok(read("components/PartUpsell.tsx").includes('href="/dashboard/upgrade?need=long"'));
  assert.ok(read("components/ResultsUpsell.tsx").includes('href="/dashboard/upgrade"'));
});

test("the 100+ streamers line is left exactly as it was", () => {
  assert.ok(page.includes('Join <span className="text-foreground font-semibold">100+ streamers</span> clipping with Klyp'));
});
