import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RESULTS_KEPT_DAYS, resultsCutoffIso, resultsDaysLeft, resultsKeptDays } from "../lib/results-retention.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");
const DAY = 86_400_000, NOW = Date.parse("2026-11-05T12:00:00Z");

test("results are kept 5 days on Free and 30 on Pro (not 7)", () => {
  assert.deepEqual({ ...RESULTS_KEPT_DAYS }, { free: 5, pro: 30 });
  assert.equal(resultsKeptDays(false), 5);
  assert.equal(resultsKeptDays(true), 30);
  assert.equal(resultsCutoffIso(false, NOW), new Date(NOW - 5 * DAY).toISOString());
  assert.equal(resultsCutoffIso(true, NOW), new Date(NOW - 30 * DAY).toISOString());
});

test("days left counts up to the end of the window and never goes below zero", () => {
  const done = (daysAgo) => new Date(NOW - daysAgo * DAY).toISOString();
  assert.equal(resultsDaysLeft(done(0), false, NOW), 5);
  assert.equal(resultsDaysLeft(done(1), false, NOW), 4);
  assert.equal(resultsDaysLeft(done(4.5), false, NOW), 1);
  assert.equal(resultsDaysLeft(done(5), false, NOW), 0);
  assert.equal(resultsDaysLeft(done(9), false, NOW), 0);
  assert.equal(resultsDaysLeft(done(9), true, NOW), 21);
  assert.equal(resultsDaysLeft("garbage", false, NOW), 0);
});

test("the last-analysis route returns only the signed-in user's recent finished result", () => {
  const route = read("app/api/analyze/last/route.ts");
  assert.match(route, /process\.env\.DEPLOYMENT_TARGET !== "processing"/);
  assert.match(route, /getProfileFromToken\(token\)/);
  assert.match(route, /\.eq\("user_id", profile\.id\)\.eq\("status", "completed"\)/);
  assert.match(route, /\.gte\("updated_at", resultsCutoffIso\(isPro\)\)/);
  assert.match(route, /clips\.length === 0\) return withCors\(NextResponse\.json\(\{ job: null \}\)\)/);
  assert.match(route, /planOf\(profile\) === "pro"/);
});

test("the Analyze panel brings the last analysis back, warns before leaving, and offers to save first", () => {
  const panel = read("components/AnalyzePanel.tsx");
  assert.match(panel, /processingFetch\("\/api\/analyze\/last"\)/);
  assert.match(panel, /handleEvent\(lastJob\.result\)/);
  assert.match(panel, /klyp-last-analysis-dismissed/);
  // Browser warning on close or refresh, and our own box for a click to another Klyp page.
  assert.match(panel, /window\.addEventListener\("beforeunload", beforeUnload\)/);
  assert.match(panel, /document\.addEventListener\("click", onClick, true\)/);
  assert.match(panel, /if \(to\.origin !== window\.location\.origin\) return;/);
  assert.match(panel, /if \(unsavedCount === 0\) return;/);
  assert.match(panel, /<UnsavedClipsDialog count=\{unsavedCount\} keptDays=\{keptDays\}/);
  assert.match(panel, /const ids = await keepIndices\(/);
  assert.match(panel, /if \(ids\) leaveNow\(\);/);
  // The banner only shows when there are no clips on screen and nothing is running.
  assert.match(panel, /\{!clips && !loading && lastJob && <LastAnalysisBanner/);
});

test("the banner and the box say the right things", () => {
  const banner = read("components/LastAnalysisBanner.tsx");
  assert.match(banner, /Your last analysis is ready/);
  assert.match(banner, /View my clips/);
  assert.match(banner, /Dismiss/);
  assert.match(banner, /less than a day/);
  const dialog = read("components/UnsavedClipsDialog.tsx");
  assert.match(dialog, /You have clips that aren&apos;t saved/);
  assert.match(dialog, /kept for \{keptDays\} days\{isPro \? "" : " on the free plan"\}/);
  assert.match(dialog, /Save all clips/);
  assert.match(dialog, /Stay on this page/);
  assert.match(dialog, /e\.key === "Escape"/);
});

test("saved clip footage still follows the same 5 and 30 days as the database rule", () => {
  const migration = read("supabase/migrations/032_r2_retention.sql");
  assert.match(migration, /then interval '30 days' else interval '5 days'/);
});
