import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { yearlyEligibility, getYearlyState, switchToYearly } from "../lib/yearly-switch.ts";

const monthlySub = (over = {}) => ({
  id: "sub_1", status: "active", cancel_at_period_end: false, pause_collection: null, discounts: [], metadata: { user_id: "u1" },
  items: { data: [{ id: "si_1", price: { product: "prod_1", recurring: { interval: "month" } } }] }, ...over,
});

function fakes(sub, { updateError, dbError } = {}) {
  const calls = { update: [], profile: [] };
  const stripe = {
    subscriptions: {
      retrieve: async () => sub,
      update: async (id, params) => {
        calls.update.push({ id, params });
        if (updateError) throw updateError;
        return { ...sub, latest_invoice: { amount_paid: 26000 } };
      },
    },
    prices: { retrieve: async () => ({ active: true, unit_amount: 27600, currency: "usd", recurring: { interval: "year" } }) },
  };
  const admin = { from: () => ({ update: (v) => ({ eq: () => ({ eq: async (...a) => { calls.profile.push([v, ...a]); return { error: dbError ?? null }; } }) }) }) };
  return { deps: { stripe, admin }, calls };
}
const ctx = { userId: "u1", subscriptionId: "sub_1" };

test("only an active, undiscounted, uncancelled monthly plan can switch", () => {
  assert.equal(yearlyEligibility(monthlySub()).eligible, true);
  const code = (over) => yearlyEligibility(monthlySub(over)).code;
  assert.equal(code({ status: "past_due" }), "not_active");
  assert.equal(code({ cancel_at_period_end: true }), "cancelling");
  assert.equal(code({ pause_collection: { behavior: "void" } }), "paused");
  assert.equal(code({ discounts: [{ id: "di_1" }] }), "discounted");
  assert.equal(code({ items: { data: [{ id: "si_1", price: { product: "p", recurring: { interval: "year" } } }] } }), "already_yearly");
});

test("switching asks Stripe for a $276 yearly price on the same product, credit the unused month, fail whole if the card fails", async () => {
  const { deps, calls } = fakes(monthlySub());
  const r = await switchToYearly(deps, ctx);
  assert.equal(r.status, 200);
  assert.equal(r.body.charged_cents, 26000);
  const p = calls.update[0].params;
  assert.deepEqual(p.items, [{ id: "si_1", price_data: { currency: "usd", product: "prod_1", unit_amount: 27600, recurring: { interval: "year" } } }]);
  assert.equal(p.proration_behavior, "always_invoice");
  assert.equal(p.payment_behavior, "error_if_incomplete");
  assert.deepEqual(calls.profile[0].slice(0, 1), [{ billing_interval: "year" }]);
});

test("a configured yearly price is used only when it matches the advertised offer", async () => {
  const { deps, calls } = fakes(monthlySub());
  await switchToYearly({ ...deps, configuredYearlyPriceId: "price_y" }, ctx);
  assert.deepEqual(calls.update[0].params.items, [{ id: "si_1", price: "price_y" }]);
  const bad = fakes(monthlySub());
  bad.deps.stripe.prices.retrieve = async () => ({ active: true, unit_amount: 30000, currency: "usd", recurring: { interval: "year" } });
  const r = await switchToYearly({ ...bad.deps, configuredYearlyPriceId: "price_y" }, ctx);
  assert.equal(r.status, 500);
  assert.equal(bad.calls.update.length, 0);
});

test("ineligible plans are refused without touching Stripe's subscription", async () => {
  const { deps, calls } = fakes(monthlySub({ discounts: [{ id: "di_1" }] }));
  const r = await switchToYearly(deps, ctx);
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "discounted");
  assert.equal(calls.update.length, 0);
});

test("a declined card changes nothing and says so", async () => {
  const { deps, calls } = fakes(monthlySub(), { updateError: Object.assign(new Error("Your card was declined."), { type: "StripeCardError" }) });
  const r = await switchToYearly(deps, ctx);
  assert.equal(r.status, 402);
  assert.match(String(r.body.error), /plan was not changed/);
  assert.equal(calls.profile.length, 0);
});

test("if recording the interval fails after Stripe switched, the switch still succeeds (the webhook records it)", async () => {
  const { deps } = fakes(monthlySub(), { dbError: new Error("db down") });
  assert.equal((await switchToYearly(deps, ctx)).status, 200);
  assert.match(readFileSync(new URL("../app/api/stripe/webhook/route.ts", import.meta.url), "utf8"), /if \(sub\.status === "active"\) await setBillingInterval\(sub\.id, intervalOf\(sub\)\)/);
});

test("state reports eligibility; the route refuses signed-out and complimentary accounts", async () => {
  const { deps } = fakes(monthlySub());
  assert.deepEqual((await getYearlyState(deps, ctx)).body, { eligible: true, price_cents: 27600 });
  const route = readFileSync(new URL("../app/api/stripe/switch-yearly/route.ts", import.meta.url), "utf8");
  assert.match(route, /status: 401/);
  assert.match(route, /profile\.tier !== "pro" \|\| !profile\.stripe_subscription_id/);
});

test("the Pro card offers the switch only through the eligibility check", () => {
  const page = readFileSync(new URL("../app/(dashboard)/dashboard/upgrade/page.tsx", import.meta.url), "utf8");
  assert.match(page, /fetch\("\/api\/stripe\/switch-yearly"\)/);
  assert.match(page, /Switch to yearly: \$276\/yr, save 18%/);
  assert.match(page, /if \(tier !== "pro" \|\| complimentaryPro\) return;/);
});
