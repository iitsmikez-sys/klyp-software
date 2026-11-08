import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");
const panel = read("components/AnalyzePanel.tsx");
const card = read("components/FoundClipCard.tsx");
const upgrade = read("app/(dashboard)/dashboard/upgrade/page.tsx");

test("the migration makes a private events table: people add their own rows and nobody reads them from the browser", () => {
  const sql = read("supabase/migrations/048_usage_events.sql");
  assert.match(sql, /create table if not exists public\.usage_events/);
  assert.match(sql, /name text not null check \(name ~ '\^\[a-z_\]\{1,40\}\$'\)/);
  assert.match(sql, /pg_column_size\(props\) < 2000/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /for insert to authenticated with check \(auth\.uid\(\) = user_id\)/);
  assert.match(sql, /revoke all on public\.usage_events from public, anon, authenticated/);
  assert.match(sql, /grant insert on public\.usage_events to authenticated/);
  assert.doesNotMatch(sql, /grant (select|all)[^;]*to authenticated/i);
});

test("the tracker is silent: signed out, missing table or any error does nothing and shows nothing", () => {
  const track = read("lib/track.ts");
  assert.match(track, /from\("usage_events"\)\.insert\(\{ user_id: userId, name, props \}\)/);
  assert.match(track, /if \(!userId\) return;/);
  assert.match(track, /catch \{/);
  assert.doesNotMatch(track, /throw |console\.error/);
});

test("every kind of download on the results page is recorded, with length, time taken and whether it worked", () => {
  assert.match(panel, /import \{ trackEvent, type EventProps \} from "@\/lib\/track";/);
  assert.match(panel, /kind: raw \? "raw" : ready \? "ready" : "styled"/);
  assert.match(panel, /clip_seconds: Math\.round\(clip\.end_seconds - clip\.start_seconds\)/);
  assert.match(panel, /downloadProps\(\{ ok: true, cached: false, took_ms: Date\.now\(\) - rawStarted \}\)/);
  assert.match(panel, /downloadProps\(\{ ok: false, cached: false, took_ms: Date\.now\(\) - rawStarted, error:/);
  assert.equal((panel.match(/cached: true, took_ms: 0/g) ?? []).length, 2, "a repeat download from the cache is recorded too");
  assert.match(panel, /kind: "zip", clips: total, plan: isPro \? "pro" : "free", ok: true/);
  assert.match(panel, /kind: "zip", clips: total, plan: isPro \? "pro" : "free", ok: false/);
});

test("the steps to payment are recorded: upgrade page visit, click on Get Pro, checkout started, header link", () => {
  assert.match(upgrade, /void trackEvent\("upgrade_view"\)/);
  assert.match(upgrade, /if \(viewTracked\.current \|\| balance === null \|\| isPro\) return;/);
  assert.match(upgrade, /trackEvent\("upgrade_click", \{ interval, first_month: firstMonthCents !== null \}\)/);
  assert.match(upgrade, /trackEvent\("checkout_started", \{ interval \}\)/);
  assert.ok(upgrade.indexOf('trackEvent("upgrade_click"') < upgrade.indexOf('fetch("/api/stripe/checkout", {'), "the click is recorded before the request");
  assert.match(read("components/UpgradeButton.tsx"), /trackEvent\("upgrade_link_click", \{ from: "header" \}\)/);
});

test("free accounts see a quiet watermark line under the Download note, linking to Pro; Pro accounts never do", () => {
  assert.match(card, /showWatermarkNudge = false/);
  assert.match(card, /\{showWatermarkNudge && <p/);
  assert.match(card, /Free clips include a Klyp watermark\. Remove it with Pro/);
  assert.match(card, /href="\/dashboard\/upgrade"/);
  assert.match(card, /trackEvent\('watermark_nudge_click'\)/);
  assert.match(panel, /showWatermarkNudge=\{!isPro\}/);
  // it sits right under the note, before the Preview row
  assert.ok(card.indexOf("data-download-note") < card.indexOf("data-watermark-nudge"));
  assert.ok(card.indexOf("data-watermark-nudge") < card.indexOf(">Preview</button>"));
});
