import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ensureFirstMonthCoupon, firstMonthOfferAvailable, FIRST_MONTH_COUPON_ID, FIRST_MONTH_DISCOUNT_CENTS, FIRST_MONTH_PRICE_CENTS } from "../lib/first-month-offer.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");

test("the first month costs $17: $28 minus an $11 coupon", () => {
  assert.equal(FIRST_MONTH_PRICE_CENTS, 1700);
  assert.equal(FIRST_MONTH_DISCOUNT_CENTS, 1100);
});

test("only someone from the ad link who never subscribed qualifies", () => {
  assert.equal(firstMonthOfferAvailable({ tier: "free" }, {}, true), true);
  assert.equal(firstMonthOfferAvailable({ tier: "free", stripe_customer_id: "cus_1" }, {}, true), false);
  assert.equal(firstMonthOfferAvailable({ tier: "free", stripe_subscription_id: "sub_1" }, {}, true), false);
  assert.equal(firstMonthOfferAvailable({ tier: "pro" }, {}, true), false);
  assert.equal(firstMonthOfferAvailable({ tier: "free", complimentary_pro: true }, {}, true), false);
  assert.equal(firstMonthOfferAvailable(null, {}, true), false);
});

test("without the ad link there is no offer, unless FIRST_MONTH_OFFER=all", () => {
  assert.equal(firstMonthOfferAvailable({ tier: "free" }, {}), false);
  assert.equal(firstMonthOfferAvailable({ tier: "free" }, {}, false), false);
  assert.equal(firstMonthOfferAvailable({ tier: "free" }, { FIRST_MONTH_OFFER: "all" }, false), true);
  assert.equal(firstMonthOfferAvailable({ tier: "free", stripe_customer_id: "cus_1" }, { FIRST_MONTH_OFFER: "all" }, false), false);
});

test("FIRST_MONTH_OFFER=off stops the offer", () => {
  assert.equal(firstMonthOfferAvailable({ tier: "free" }, { FIRST_MONTH_OFFER: "off" }, true), false);
  assert.equal(firstMonthOfferAvailable({ tier: "free" }, { FIRST_MONTH_OFFER: "OFF " }, true), false);
  assert.equal(firstMonthOfferAvailable({ tier: "free" }, { FIRST_MONTH_OFFER: "on" }, true), true);
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
  assert.ok(route.includes("const newMonthly = !yearly && !billing.checkoutCustomerId && isNewCustomer(profile);"));
  assert.ok(route.includes("const firstMonth = newMonthly && firstMonthOfferAvailable(profile, process.env, hasOfferLink(req));"));
  assert.ok(route.includes("discounts: [{ coupon: couponId }]"));
  const page = read("app/(dashboard)/dashboard/upgrade/page.tsx");
  assert.ok(page.includes('fetch("/api/stripe/checkout")'));
  assert.ok(page.includes("USD first month"));
  assert.ok(!page.includes("40% off your first month"));
});

test("the proxy saves the ad link in a 30-day cookie, and the pricing card no longer says early adopter", async () => {
  const proxy = read("proxy.ts");
  assert.ok(proxy.includes('matcher: ["/", "/dashboard/:path*", "/login"]'));
  assert.ok(proxy.includes("if (fromAd) saveOffer(response, request);") && proxy.includes("if (fromAd) saveOffer(supabaseResponse, request);"));
  const cookie = await import("../lib/offer-cookie.ts");
  assert.deepEqual([cookie.OFFER_COOKIE, cookie.OFFER_VALUE, cookie.OFFER_PARAM, cookie.OFFER_COOKIE_MAX_AGE], ["klyp_offer", "17", "offer", 2592000]);
  assert.ok(!read("app/(dashboard)/dashboard/upgrade/page.tsx").includes("early adopter"));
});

test("isNewCustomer: only people who never subscribed or bought and are not Pro", async () => {
  const { isNewCustomer } = await import("../lib/first-month-offer.ts");
  assert.equal(isNewCustomer({ tier: "free" }), true);
  assert.equal(isNewCustomer({ tier: "free", stripe_customer_id: "cus_1" }), false);
  assert.equal(isNewCustomer({ tier: "pro" }), false);
  assert.equal(isNewCustomer({ tier: "free", complimentary_pro: true }), false);
  assert.equal(isNewCustomer(null), false);
  const page = read("app/(dashboard)/dashboard/upgrade/page.tsx");
  assert.ok(page.includes("Have a promo code? Enter it at checkout."));
  assert.ok(read("app/api/stripe/checkout/route.ts").includes("promo_code_field"));
});

test("an offer link with an end date gives $17 until the end of that day (Pacific) and then stops", async () => {
  const { offerDeadlineMs, offerCookieValueFor, offerCookieActive } = await import("../lib/offer-cookie.ts");
  const end = Date.parse("2026-11-09T23:59:59-08:00");
  assert.equal(offerDeadlineMs("2026-11-09"), end);
  for (const bad of [null, undefined, "", "nov9", "2026-13-40", "2026-11-9", "2026-11-09; drop"]) assert.equal(offerDeadlineMs(bad), null, String(bad));
  // No end date: the ad link, never expires.
  assert.equal(offerCookieValueFor(undefined), "17");
  assert.equal(offerCookieValueFor(null), "17");
  // Before the end: saved with its deadline. After the end, or a nonsense date: nothing is saved.
  assert.equal(offerCookieValueFor("2026-11-09", end - 1000), `17|${end}`);
  assert.equal(offerCookieValueFor("2026-11-09", end + 1000), null);
  assert.equal(offerCookieValueFor("garbage", end - 1000), null);
  // A saved cookie keeps working until the deadline, then stops. The plain ad cookie always works.
  assert.equal(offerCookieActive("17", end + 10_000_000), true);
  assert.equal(offerCookieActive(`17|${end}`, end - 1), true);
  assert.equal(offerCookieActive(`17|${end}`, end), true);
  assert.equal(offerCookieActive(`17|${end}`, end + 1), false);
  assert.equal(offerCookieActive("17|abc", end - 1), false);
  assert.equal(offerCookieActive("18", end - 1), false);
  assert.equal(offerCookieActive(undefined), false);
  assert.equal(offerCookieActive(""), false);
});
