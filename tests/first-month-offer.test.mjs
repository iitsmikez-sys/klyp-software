import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ensureFirstMonthCoupon, firstMonthOfferAvailable, FIRST_MONTH_COUPON_ID, FIRST_MONTH_DISCOUNT_CENTS, FIRST_MONTH_PRICE_CENTS } from "../lib/first-month-offer.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");

test("the first month costs $17: $28 minus an $11 coupon", () => {
  assert.equal(FIRST_MONTH_PRICE_CENTS, 1700);
  assert.equal(FIRST_MONTH_DISCOUNT_CENTS, 1100);
});

test("only someone who never subscribed qualifies", () => {
  assert.equal(firstMonthOfferAvailable({ tier: "free" }, {}), true);
  assert.equal(firstMonthOfferAvailable({ tier: "free", stripe_customer_id: "cus_1" }, {}), false);
  assert.equal(firstMonthOfferAvailable({ tier: "free", stripe_subscription_id: "sub_1" }, {}), false);
  assert.equal(firstMonthOfferAvailable({ tier: "pro" }, {}), false);
  assert.equal(firstMonthOfferAvailable({ tier: "free", complimentary_pro: true }, {}), false);
  assert.equal(firstMonthOfferAvailable(null, {}), false);
});

test("FIRST_MONTH_OFFER=off stops the offer", () => {
  assert.equal(firstMonthOfferAvailable({ tier: "free" }, { FIRST_MONTH_OFFER: "off" }), false);
  assert.equal(firstMonthOfferAvailable({ tier: "free" }, { FIRST_MONTH_OFFER: "OFF " }), false);
  assert.equal(firstMonthOfferAvailable({ tier: "free" }, { FIRST_MONTH_OFFER: "on" }), true);
});

test("the coupon is created once with the right terms, and reused", async () => {
  const created = [];
  const missing = Object.assign(new Error("No such coupon"), { code: "resource_missing" });
  const empty = { coupons: { retrieve: async () => { throw missing; }, create: async (p) => { created.push(p); } } };
  assert.equal(await ensureFirstMonthCoupon(empty), FIRST_MONTH_COUPON_ID);
  assert.deepEqual([created[0].id, created[0].amount_off, created[0].currency, created[0].duration], [FIRST_MONTH_COUPON_ID, 1100, "usd", "once"]);
  const have = { coupons: { retrieve: async () => ({ amount_off: 1100, currency: "usd", duration: "once" }), create: async () => assert.fail("recreated") } };
  assert.equal(await ensureFirstMonthCoupon(have), FIRST_MONTH_COUPON_ID);
  const wrong = { coupons: { retrieve: async () => ({ amount_off: 500, currency: "usd", duration: "once" }), create: async () => assert.fail("recreated") } };
  await assert.rejects(() => ensureFirstMonthCoupon(wrong), /does not match/);
});

test("checkout applies the coupon only to new monthly subscribers; the page shows the offer", () => {
  const route = read("app/api/stripe/checkout/route.ts");
  assert.ok(route.includes("!yearly && !billing.checkoutCustomerId && firstMonthOfferAvailable(profile)"));
  assert.ok(route.includes("discounts: [{ coupon: couponId }]"));
  const page = read("app/(dashboard)/dashboard/upgrade/page.tsx");
  assert.ok(page.includes('fetch("/api/stripe/checkout")'));
  assert.ok(page.includes("USD first month"));
  assert.ok(!page.includes("40% off your first month"));
});
