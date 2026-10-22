import assert from "node:assert/strict";
import test from "node:test";
import { paidSubscriptionGrant, paidSubscriptionIsActive, shouldDowngradeSubscription } from "../lib/stripe-payment.ts";

function invoiceEvent(overrides = {}) {
  return {
    id: "evt_paid_1",
    created: 1760000010,
    type: "invoice.paid",
    data: { object: {
      id: "in_first_cycle",
      status: "paid",
      amount_paid: 2800,
      billing_reason: "subscription_create",
      customer: "cus_1",
      parent: { subscription_details: {
        subscription: "sub_1",
        metadata: { user_id: "user_1" },
      } },
      lines: { data: [{
        period: { start: 1760000000, end: 1762600000 },
        parent: { type: "subscription_item_details", subscription_item_details: {
          subscription: "sub_1", proration: false,
        } },
      }] },
      ...overrides,
    } },
  };
}

test("a paid first subscription invoice grants once using the invoice ID", () => {
  assert.deepEqual(paidSubscriptionGrant(invoiceEvent()), {
    invoiceId: "in_first_cycle",
    subscriptionId: "sub_1",
    customerId: "cus_1",
    userId: "user_1",
    periodStart: 1760000000,
    periodEnd: 1762600000,
    paidEventCreated: 1760000010,
  });
});

test("a paid renewal uses its own invoice ID regardless of Stripe event ID", () => {
  const first = invoiceEvent({ id: "in_renewal", billing_reason: "subscription_cycle" });
  first.id = "evt_a";
  const replay = structuredClone(first);
  replay.id = "evt_b";
  assert.equal(paidSubscriptionGrant(first)?.invoiceId, "in_renewal");
  assert.equal(paidSubscriptionGrant(replay)?.invoiceId, "in_renewal");
});

test("checkout completion alone never grants Sparks", () => {
  assert.equal(paidSubscriptionGrant({ type: "checkout.session.completed", data: { object: { payment_status: "unpaid" } } }), null);
  assert.equal(paidSubscriptionGrant({ type: "checkout.session.completed", data: { object: { payment_status: "paid" } } }), null);
});

test("failed, zero-payment, and mid-cycle invoices do not refill Sparks", () => {
  assert.equal(paidSubscriptionGrant({ ...invoiceEvent({ status: "open" }), type: "invoice.payment_failed" }), null);
  assert.equal(paidSubscriptionGrant(invoiceEvent({ status: "open" })), null);
  assert.equal(paidSubscriptionGrant(invoiceEvent({ amount_paid: 0 })), null);
  assert.equal(paidSubscriptionGrant(invoiceEvent({ billing_reason: "subscription_update" })), null);
  assert.equal(paidSubscriptionGrant(invoiceEvent({ parent: null })), null);
  assert.equal(paidSubscriptionGrant(invoiceEvent({ lines: { data: [] } })), null);
  assert.equal(paidSubscriptionGrant(invoiceEvent({ lines: { data: [{
    period: { start: 1760000000, end: 1762600000 },
    parent: { type: "subscription_item_details", subscription_item_details: {
      subscription: "sub_1", proration: true,
    } },
  }] } })), null);
});

test("subscription status updates cannot upgrade before a paid invoice", () => {
  for (const status of ["active", "trialing", "past_due", "incomplete"]) {
    assert.equal(shouldDowngradeSubscription(status), false);
  }
  for (const status of ["canceled", "unpaid", "incomplete_expired", "paused"]) {
    assert.equal(shouldDowngradeSubscription(status), true);
  }
});

test("a paid invoice grants only while its matching subscription is active", () => {
  const grant = paidSubscriptionGrant(invoiceEvent());
  const subscription = { id: "sub_1", status: "active", customer: "cus_1", metadata: { user_id: "user_1" },
    items: { data: [{ price: { active: true, type: "recurring", currency: "usd", unit_amount: 2800,
      recurring: { interval: "month", interval_count: 1, usage_type: "licensed" } } }] } };
  assert.equal(paidSubscriptionIsActive(subscription, grant), true);
  assert.equal(paidSubscriptionIsActive({ ...subscription, status: "past_due" }, grant), false);
  assert.equal(paidSubscriptionIsActive({ ...subscription, status: "canceled" }, grant), false);
  assert.equal(paidSubscriptionIsActive({ ...subscription, customer: "cus_other" }, grant), false);
  assert.equal(paidSubscriptionIsActive({ ...subscription, metadata: {} }, grant), false);
  assert.equal(paidSubscriptionIsActive({ ...subscription, metadata: { user_id: "someone_else" } }, grant), false);
});

test("a paid invoice cannot grant Pro for a subscription at a different price", () => {
  const grant = paidSubscriptionGrant(invoiceEvent());
  const subscription = { id: "sub_1", status: "active", customer: "cus_1", metadata: { user_id: "user_1" },
    items: { data: [{ price: { active: true, type: "recurring", currency: "usd", unit_amount: 100,
      recurring: { interval: "month", interval_count: 1, usage_type: "licensed" } } }] } };
  assert.equal(paidSubscriptionIsActive(subscription, grant), false);
});

test("a configured Pro price must match the billed subscription price ID", () => {
  const grant = paidSubscriptionGrant(invoiceEvent());
  const subscription = { id: "sub_1", status: "active", customer: "cus_1", metadata: { user_id: "user_1" },
    items: { data: [{ price: { id: "price_other", active: true, type: "recurring", currency: "usd", unit_amount: 2800,
      recurring: { interval: "month", interval_count: 1, usage_type: "licensed" } } }] } };
  assert.equal(paidSubscriptionIsActive(subscription, grant, "price_klyp_pro"), false);
  subscription.items.data[0].price.id = "price_klyp_pro";
  assert.equal(paidSubscriptionIsActive(subscription, grant, "price_klyp_pro"), true);
});
