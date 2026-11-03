import assert from "node:assert/strict";
import test from "node:test";
import {
  PLAN_LIMITS, planOf, sourceKindOf, checkSourceLimit, maxSecondsFor, uploadsAllowed, autoClipAllowed,
  describeLimits, UPLOAD_PRO_MESSAGE,
} from "../lib/plan-limits.ts";

const H = 3600;
const pro = { tier: "pro", stripe_subscription_id: "sub_1", complimentary_pro: false };
const proComp = { tier: "pro", stripe_subscription_id: null, complimentary_pro: true };
const freeTier = { tier: "free", stripe_subscription_id: null, complimentary_pro: false };
const proFlagOnly = { tier: "pro", stripe_subscription_id: null, complimentary_pro: false }; // drifted flag, no subscription

test("the limits are exactly the agreed plan structure", () => {
  assert.deepEqual(PLAN_LIMITS.free, { youtube: 2 * H, twitch: 2 * H, upload: 0, autoClip: false });
  assert.deepEqual(PLAN_LIMITS.pro, { youtube: 8 * H, twitch: 8 * H, upload: 8 * H, autoClip: true });
});

test("plan comes from real access: subscription or complimentary, never the bare tier flag", () => {
  assert.equal(planOf(pro), "pro");
  assert.equal(planOf(proComp), "pro");
  assert.equal(planOf(freeTier), "free");
  assert.equal(planOf(proFlagOnly), "free");
});

test("source kind comes from the source key", () => {
  assert.equal(sourceKindOf("youtube:dQw4w9WgXcQ"), "youtube");
  assert.equal(sourceKindOf("twitch:123456"), "twitch");
  assert.equal(sourceKindOf("upload:abc-123"), "upload");
  for (const bad of ["", null, undefined, "vimeo:1", "youtube", "youtube:", ":abc", "UPLOAD:x"]) assert.equal(sourceKindOf(bad), null, String(bad));
});

test("Free YouTube: up to 2 hours passes, beyond is rejected with an upgrade hint", () => {
  assert.equal(checkSourceLimit("free", "youtube", 2 * H).ok, true);
  assert.equal(checkSourceLimit("free", "youtube", 2 * H + 30).ok, true); // slack
  const over = checkSourceLimit("free", "youtube", 2 * H + 31);
  assert.equal(over.ok, false);
  assert.equal(over.status, 413);
  assert.match(over.message, /Free plan supports YouTube videos up to 2 hours/);
  assert.match(over.message, /Pro supports YouTube videos up to 8 hours/);
});

test("Free Twitch: up to 2 hours passes, beyond is rejected", () => {
  assert.equal(checkSourceLimit("free", "twitch", 2 * H).ok, true);
  const over = checkSourceLimit("free", "twitch", 2 * H + 120);
  assert.equal(over.ok, false);
  assert.equal(over.status, 413);
  assert.match(over.message, /Free plan supports Twitch VODs up to 2 hours;/);
});

test("Free uploads are rejected outright, whatever the length", () => {
  for (const seconds of [60, 1 * H, 8 * H]) {
    const r = checkSourceLimit("free", "upload", seconds);
    assert.equal(r.ok, false);
    assert.equal(r.status, 403);
    assert.equal(r.message, UPLOAD_PRO_MESSAGE);
  }
  assert.equal(uploadsAllowed("free"), false);
});

test("Pro: YouTube, Twitch and uploads all pass up to 8 hours and fail beyond", () => {
  for (const kind of ["youtube", "twitch", "upload"]) {
    assert.equal(checkSourceLimit("pro", kind, 8 * H).ok, true, kind);
    const over = checkSourceLimit("pro", kind, 8 * H + 31);
    assert.equal(over.ok, false, kind);
    assert.equal(over.status, 413, kind);
    assert.match(over.message, /Pro plan supports .* up to 8 hours/, kind);
    assert.doesNotMatch(over.message, /Pro supports/, "Pro users are not told to upgrade");
  }
});

test("unreadable lengths are refused (fail closed)", () => {
  for (const bad of [0, -5, NaN, Infinity]) assert.equal(checkSourceLimit("pro", "youtube", bad).ok, false, String(bad));
});

test("auto-clipping is Pro-only", () => {
  assert.equal(autoClipAllowed("free"), false);
  assert.equal(autoClipAllowed("pro"), true);
});

test("limits are summarized for the dashboard", () => {
  assert.deepEqual(describeLimits("free"), { plan: "free", youtubeMaxSeconds: 2 * H, twitchMaxSeconds: 2 * H, uploadMaxSeconds: 0, uploadsAllowed: false, autoClipAllowed: false });
  assert.equal(describeLimits("pro").uploadsAllowed, true);
  assert.equal(maxSecondsFor("pro", "twitch"), 8 * H);
});

/* ── things that must NOT change with the plan structure ── */
import { analysisCharge, estimateSparks, CLIP_COUNT_COST, clipCharge, UPSCALE_COST } from "../lib/sparks.ts";
import { SPARKS_ALLOWANCE } from "../lib/tier.ts";

test("Spark pricing: per video with clips included, allowances unchanged", () => {
  assert.deepEqual(Object.values(CLIP_COUNT_COST), [0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual([10, 29 * 60].map((s) => estimateSparks(s)), [20, 20]);
  assert.equal(estimateSparks(45 * 60), 35);
  assert.equal(estimateSparks(90 * 60), 50);
  assert.equal(estimateSparks(2 * H), 65);
  assert.equal(estimateSparks(4 * H), 65);
  assert.equal(estimateSparks(4 * H + 1), 80);
  assert.equal(estimateSparks(6 * H), 80);
  assert.equal(estimateSparks(8 * H), 120);
  assert.equal(UPSCALE_COST, 35);
  assert.deepEqual(SPARKS_ALLOWANCE, { free: 60, pro: 500 });
});

test("clips add no charge; a run that finds none costs half", () => {
  assert.equal(clipCharge(10, 4), 0);
  assert.equal(clipCharge(10, 10), 0);
  assert.equal(analysisCharge(45 * 60, 0), 18);
  assert.equal(analysisCharge(45 * 60, 3), 35);
});
