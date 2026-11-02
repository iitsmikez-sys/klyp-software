import assert from "node:assert/strict";
import test from "node:test";
import {
  estimateSparks,
  clipCharge,
  CLIP_COUNT_COST,
  TYPICAL_ANALYSIS_COST,
  vodsAffordable,
} from "../lib/sparks.ts";
import {
  MAX_VOD_SECONDS,
  exceedsMaxDuration,
  parseProbedDuration,
  tooLongMessage,
  formatDuration,
} from "../lib/duration-limits.ts";

const H = 3600;
const M = 60;

test("short VODs keep the existing tiers", () => {
  assert.equal(estimateSparks(1), 10);
  assert.equal(estimateSparks(29 * M + 59), 10);
  assert.equal(estimateSparks(30 * M), 20);
  assert.equal(estimateSparks(45 * M), 20);
  assert.equal(estimateSparks(59 * M + 59), 20);
  assert.equal(estimateSparks(60 * M), 35);
  assert.equal(estimateSparks(119 * M + 59), 35);
});

test("2 hours is 50 and each extra hour adds 15", () => {
  assert.equal(estimateSparks(2 * H), 50);
  assert.equal(estimateSparks(3 * H), 65);
  assert.equal(estimateSparks(4 * H), 80);
  assert.equal(estimateSparks(6 * H), 110);
  assert.equal(estimateSparks(8 * H), 140);
});

test("the proposal's other examples: 45 minutes stays at the existing 20 (Option B)", () => {
  assert.equal(estimateSparks(45 * M), 20);
});

test("partial hours prorate by the second and round up to a whole Spark", () => {
  // Tolerance of 30s past 2h is free.
  assert.equal(estimateSparks(2 * H + 30), 50);
  // 1 second over the tolerance costs the first extra Spark.
  assert.equal(estimateSparks(2 * H + 31), 51);
  assert.equal(estimateSparks(2 * H + 5 * M), 52); // 270s billable -> ceil(1.125) = 2 extra
  assert.equal(estimateSparks(2 * H + 30 * M), 58);
  assert.equal(estimateSparks(2 * H + 90 * M), 73);
  // Just past 3h is one Spark more than exactly 3h.
  assert.ok(estimateSparks(3 * H + 60) > estimateSparks(3 * H));
});

test("price never decreases as a video gets longer", () => {
  let prev = 0;
  for (let s = 1; s <= MAX_VOD_SECONDS + 3600; s += 17) {
    const cost = estimateSparks(s);
    assert.ok(cost >= prev, `price dropped at ${s}s: ${cost} < ${prev}`);
    prev = cost;
  }
});

test("invalid durations are billed as the cheapest tier, not free or NaN", () => {
  assert.equal(estimateSparks(NaN), 10);
  assert.equal(estimateSparks(-5), 10);
  assert.equal(estimateSparks(0), 10);
  assert.equal(estimateSparks(Infinity), 10);
});

test("clip charges are unchanged and independent of VOD length", () => {
  assert.deepEqual(CLIP_COUNT_COST, { 3: 10, 5: 20, 7: 30, 10: 40, 12: 50, 20: 80 });
  assert.equal(clipCharge(10, 4), 16);
  assert.equal(clipCharge(5, 0), 0);
  assert.equal(clipCharge(5, 9), 20); // capped at requested
});

test("typical-run cost and the plain-language estimate did not move", () => {
  assert.equal(TYPICAL_ANALYSIS_COST, 40);
  assert.equal(vodsAffordable(500), 12);
});

test("a 500-Spark balance: worst standard run at the cap is 150 with 3 clips", () => {
  const worst = estimateSparks(MAX_VOD_SECONDS) + CLIP_COUNT_COST[3];
  assert.equal(worst, 150);
  assert.equal(Math.floor(500 / worst), 3);
});

test("max duration cap: 8h allowed (with tolerance), beyond refused", () => {
  assert.equal(exceedsMaxDuration(8 * H), false);
  assert.equal(exceedsMaxDuration(8 * H + 30), false);
  assert.equal(exceedsMaxDuration(8 * H + 31), true);
  assert.equal(exceedsMaxDuration(24 * H), true);
  assert.equal(exceedsMaxDuration(10 * M), false);
});

test("too-long message names the length and the limit", () => {
  const msg = tooLongMessage(9 * H + 5 * M);
  assert.match(msg, /9h 5m/);
  assert.match(msg, /8 hours/);
  assert.equal(formatDuration(45 * M), "45m");
});

test("probe output parsing fails closed", () => {
  assert.equal(parseProbedDuration("3600.4\n"), 3600);
  assert.equal(parseProbedDuration(" 59.6 "), 60);
  assert.equal(parseProbedDuration("NA"), null); // live stream
  assert.equal(parseProbedDuration(""), null);
  assert.equal(parseProbedDuration("0"), null);
  assert.equal(parseProbedDuration("-12"), null);
  assert.equal(parseProbedDuration("Infinity"), null);
});

test("a spoofed tiny client hint cannot lower the price: pricing only takes a measured duration", () => {
  // estimateSparks has no hint parameter; the route passes the probed value.
  assert.equal(estimateSparks.length, 1);
  assert.equal(estimateSparks(8 * H), 140);
});
