import assert from "node:assert/strict";
import test from "node:test";
import { resolveBillingState } from "../lib/stripe-billing.ts";

function missing(resource) {
  return Object.assign(new Error(`No such ${resource}`), {
    type: "StripeInvalidRequestError",
    code: "resource_missing",
    param: resource,
  });
}

test("a customer and subscription absent from the live Stripe account allow a fresh checkout", async () => {
  const stripe = {
    customers: { retrieve: async () => { throw missing("customer"); } },
    subscriptions: { retrieve: async () => { throw missing("subscription"); } },
  };
  const state = await resolveBillingState(stripe, {
    stripe_customer_id: "cus_old",
    stripe_subscription_id: "sub_old",
  });
  assert.deepEqual(state, { checkoutCustomerId: null, portalCustomerId: null });
});

test("a live subscription uses its actual customer for the billing portal", async () => {
  const stripe = {
    customers: { retrieve: async () => ({ id: "cus_stale", deleted: false }) },
    subscriptions: { retrieve: async () => ({ status: "active", customer: "cus_live" }) },
  };
  const state = await resolveBillingState(stripe, {
    stripe_customer_id: "cus_stale",
    stripe_subscription_id: "sub_live",
  });
  assert.deepEqual(state, { checkoutCustomerId: "cus_live", portalCustomerId: "cus_live" });
});

test("a deleted customer is not passed into checkout", async () => {
  const stripe = {
    customers: { retrieve: async () => ({ id: "cus_deleted", deleted: true }) },
    subscriptions: { retrieve: async () => { throw new Error("unexpected subscription lookup"); } },
  };
  const state = await resolveBillingState(stripe, {
    stripe_customer_id: "cus_deleted",
    stripe_subscription_id: null,
  });
  assert.deepEqual(state, { checkoutCustomerId: null, portalCustomerId: null });
});

test("a Stripe outage is not mistaken for a missing customer", async () => {
  const stripe = {
    customers: { retrieve: async () => { throw new Error("Stripe unavailable"); } },
    subscriptions: { retrieve: async () => { throw new Error("unexpected subscription lookup"); } },
  };
  await assert.rejects(
    resolveBillingState(stripe, { stripe_customer_id: "cus_live", stripe_subscription_id: null }),
    /Stripe unavailable/
  );
});
