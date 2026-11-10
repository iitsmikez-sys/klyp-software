import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");

test("the dashboard line says only what the app's rules say, shows no price and promises no results", () => {
  const box = read("components/DashboardUpsell.tsx");
  for (const piece of ["resultsKeptDays(false)", "resultsKeptDays(true)", "CAPTION_STYLES.length - FREE_CAPTION_STYLES.length", "Klyp watermark", 'href="/dashboard/upgrade"']) assert.ok(box.includes(piece), piece);
  assert.doesNotMatch(box, /\$\d|unlimited|∞|viral|guarantee/i);
});

test("it shows under the saved clips only for a free account whose plan has loaded, and only when there are clips", () => {
  const saved = read("components/SavedClips.tsx");
  assert.ok(saved.includes('{!loading && clips.length > 0 && balance !== null && tier !== "pro" && <DashboardUpsell />}'));
  assert.ok(saved.includes("const { balance, tier } = useSparks();"));
  assert.ok(saved.indexOf("<DashboardUpsell />") > saved.indexOf("clips.map(clip => <CompactClipCard"), "under the clips");
});

test("views and clicks are counted as plain events", () => {
  const box = read("components/DashboardUpsell.tsx");
  assert.ok(box.includes('trackEvent("dashboard_upsell_view")') && box.includes('trackEvent("dashboard_upsell_click")'));
  assert.match("dashboard_upsell_view", /^[a-z_]{1,40}$/);
});
