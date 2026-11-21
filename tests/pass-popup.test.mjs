import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shouldShowPassPopup, POPUP_QUIET_MS, POPUP_DELAY_MS } from "../lib/pass-popup.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");
const NOW = 1_800_000_000_000;
const trial = { kind: "trial", days: 4, sparks: 150, cents: 300 };
const base = { loaded: true, isFree: true, offer: trial, closedAt: null, now: NOW };

test("a free account that is offered the pass sees the pop-up", () => {
  assert.equal(shouldShowPassPopup(base), true);
  assert.equal(shouldShowPassPopup({ ...base, offer: { kind: "first_month", cents: 1700 } }), true);
});

test("never for Pro, never before the account has loaded, never without a cheap offer", () => {
  assert.equal(shouldShowPassPopup({ ...base, isFree: false }), false);
  assert.equal(shouldShowPassPopup({ ...base, loaded: false }), false);
  assert.equal(shouldShowPassPopup({ ...base, offer: { kind: "none" } }), false);
});

test("closing it keeps it away for a day, and then it may come back", () => {
  assert.equal(shouldShowPassPopup({ ...base, closedAt: NOW - 60_000 }), false);
  assert.equal(shouldShowPassPopup({ ...base, closedAt: NOW - POPUP_QUIET_MS + 1 }), false);
  assert.equal(shouldShowPassPopup({ ...base, closedAt: NOW - POPUP_QUIET_MS }), true);
  assert.equal(POPUP_QUIET_MS, 24 * 3600 * 1000);
  assert.ok(POPUP_DELAY_MS >= 5000, "it waits a few seconds, never on page load");
});

test("the dashboard shows it, and it uses the one-click checkout with the $28 line", () => {
  assert.ok(read("app/(dashboard)/dashboard/page.tsx").includes("<PassPopup />"));
  const popup = read("components/PassPopup.tsx");
  assert.ok(popup.includes('<ProOfferCta source="pass_popup"'), "the shared one-click offer, which always states the $28 and the cancel rule");
  assert.ok(popup.includes("tier === \"free\" && !complimentaryPro"), "free accounts only");
  assert.ok(popup.includes("document.querySelector('[role=\"dialog\"]')"), "never on top of another dialog");
});

test("it can be closed four ways, which are counted, and a missing picture falls back to a plain banner", () => {
  const popup = read("components/PassPopup.tsx");
  for (const way of ['"not_now"', '"escape"', '"backdrop"', '"x"']) assert.ok(popup.includes(way), way);
  assert.ok(popup.includes('trackEvent("pass_popup_view"') && popup.includes('trackEvent("pass_popup_close"'));
  assert.ok(popup.includes('role="dialog"') && popup.includes('aria-modal="true"') && popup.includes('aria-label="Close"'));
  assert.ok(popup.includes("onError={() => setImageOk(false)}"));
});
