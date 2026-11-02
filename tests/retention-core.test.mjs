import assert from "node:assert/strict";
import test from "node:test";
import {
  addMonthsUtc, applyDiscount, applyPause, cancelSubscription, DISCOUNTED_CENTS, getRetentionState,
  OFFERS_BY_REASON, RETENTION, recordSurvey, runRetentionAction, undoCancellation,
} from "../lib/retention-core.ts";
import { syncUserFromStripe } from "../lib/stripe-sync.ts";
import { makeAdmin } from "./helpers/retention-fakes.mjs";

const USER = "11111111-1111-4111-8111-111111111111";
const SUB = "sub_1";
const DAY = 86_400_000;
const PERIOD_END = Date.UTC(2026, 10, 20) / 1000; // 20 Nov 2026
const NOW = Date.UTC(2026, 10, 2);
const ctx = { userId: USER, subscriptionId: SUB };

/** A Stripe stand-in holding ONE subscription. It records every call so tests can assert what was (not) written. */
function makeStripe(opts = {}) {
  const sub = {
    id: SUB, status: "active", customer: "cus_1", cancel_at_period_end: false, pause_collection: null, discounts: [],
    items: { data: [{ current_period_end: PERIOD_END }] }, ...(opts.sub ?? {}),
  };
  const calls = [];
  const coupons = new Map(opts.coupons ?? []);
  const stripe = {
    subscriptions: {
      async retrieve(id) {
        calls.push(["retrieve", id]);
        if (opts.failRetrieve) throw new Error("stripe down");
        return structuredClone(sub);
      },
      async update(id, params, options) {
        calls.push(["update", id, params, options]);
        if (opts.failUpdate) throw new Error("stripe rejected");
        if (opts.silentNoop) return structuredClone(sub);
        if (params.discounts) sub.discounts = params.discounts.map((d) => ({ source: { coupon: { id: d.coupon } } }));
        if (params.pause_collection) sub.pause_collection = params.pause_collection;
        if ("cancel_at_period_end" in params) sub.cancel_at_period_end = params.cancel_at_period_end;
        return structuredClone(sub);
      },
    },
    coupons: {
      async retrieve(id) { calls.push(["coupon.retrieve", id]); if (!coupons.has(id)) throw Object.assign(new Error("none"), { code: "resource_missing" }); return coupons.get(id); },
      async create(params) { calls.push(["coupon.create", params]); coupons.set(params.id, params); return params; },
    },
  };
  return { stripe, sub, calls, coupons };
}

async function survey(admin, reason, extra = {}) {
  const r = await recordSurvey({ stripe: makeStripe().stripe, admin }, ctx, { reason, ...extra });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.eventId;
}
const writes = (calls) => calls.filter((c) => c[0] === "update" || c[0] === "coupon.create");

/* ───────────── the survey: every reason ───────────── */
for (const reason of ["not_good_clips", "break", "too_expensive", "not_using", "other"]) {
  test(`survey: "${reason}" is recorded and shows only its own offers`, async () => {
    const admin = makeAdmin();
    const r = await recordSurvey({ stripe: makeStripe().stripe, admin }, ctx, { reason, detail: "  hi  " });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.offers, OFFERS_BY_REASON[reason]);
    assert.equal(admin.t.cancellation_events.length, 1);
    assert.equal(admin.t.cancellation_events[0].reason, reason);
    assert.equal(admin.t.cancellation_events[0].detail, "hi");
    assert.equal(admin.t.cancellation_events[0].decision, "none");
  });
}

test("survey: only 'too expensive' is ever offered the discount; only 'break' and 'not using' the pause", () => {
  for (const [reason, offers] of Object.entries(OFFERS_BY_REASON)) {
    assert.equal(offers.includes("discount"), reason === "too_expensive", reason);
    assert.equal(offers.includes("pause"), reason === "break" || reason === "not_using", reason);
  }
});

test("survey: the 'what went wrong' follow-up is saved for 'not good clips' and refused for other reasons", async () => {
  const admin = makeAdmin();
  for (const sub of ["not_entertaining", "missing_moments", "cut_off", "other"]) {
    const id = await survey(admin, "not_good_clips", { subReason: sub });
    assert.equal(admin.t.cancellation_events.find((e) => e.id === id).sub_reason, sub);
  }
  assert.equal((await recordSurvey({ stripe: makeStripe().stripe, admin }, ctx, { reason: "break", subReason: "cut_off" })).status, 400);
  assert.equal((await recordSurvey({ stripe: makeStripe().stripe, admin }, ctx, { reason: "not_good_clips", subReason: "nonsense" })).status, 400);
});

test("survey: an unknown reason is refused, long feedback is cut to 1000 characters, a failed save never blocks cancelling", async () => {
  const admin = makeAdmin();
  assert.equal((await recordSurvey({ stripe: makeStripe().stripe, admin }, ctx, { reason: "bogus" })).status, 400);
  const id = await survey(admin, "other", { detail: "x".repeat(5000) });
  assert.equal(admin.t.cancellation_events.find((e) => e.id === id).detail.length, 1000);
  const failing = makeAdmin({ failSurveyInsert: true });
  const r = await recordSurvey({ stripe: makeStripe().stripe, admin: failing }, ctx, { reason: "other" });
  assert.equal(r.status, 500);
  assert.match(r.body.error, /still continue/);
  // cancelling needs no survey at all:
  const { stripe } = makeStripe();
  assert.equal((await cancelSubscription({ stripe, admin: failing }, ctx, {})).status, 200);
});

/* ───────────── the 40% discount ───────────── */
test("discount: the price shown is $16.80 for one payment and $28.00 after", () => {
  assert.equal(RETENTION.PRICE_CENTS, 2800);
  assert.equal(DISCOUNTED_CENTS, 1680);
  assert.equal(RETENTION.DISCOUNT_PERCENT, 40);
});

test("discount: accepted -> a one-time 40% coupon is attached, read back from Stripe, and only then reported as done", async () => {
  const admin = makeAdmin(); const s = makeStripe();
  const eventId = await survey(admin, "too_expensive");
  const r = await applyDiscount({ stripe: s.stripe, admin, now: NOW }, ctx, { eventId });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.status, r.body.nextAmountCents, r.body.thenAmountCents], ["confirmed", 1680, 2800]);
  const coupon = s.coupons.get(RETENTION.COUPON_ID);
  assert.deepEqual([coupon.percent_off, coupon.duration], [40, "once"]); // ONE billing period, then back to full price
  const update = s.calls.find((c) => c[0] === "update");
  assert.deepEqual(update[2], { discounts: [{ coupon: RETENTION.COUPON_ID }] });
  assert.match(update[3].idempotencyKey, /^klyp-discount-/); // a repeated request cannot double-apply
  assert.equal(admin.t.retention_offers[0].status, "confirmed");
  assert.equal(admin.t.cancellation_events[0].decision, "accepted_offer");
});

test("discount: the coupon is created once and reused", async () => {
  const s = makeStripe({ coupons: [[RETENTION.COUPON_ID, { id: RETENTION.COUPON_ID }]] });
  const admin = makeAdmin();
  await applyDiscount({ stripe: s.stripe, admin }, ctx, { eventId: await survey(admin, "too_expensive") });
  assert.equal(s.calls.filter((c) => c[0] === "coupon.create").length, 0);
});

for (const reason of ["not_good_clips", "break", "not_using", "other"]) {
  test(`discount: refused for "${reason}" — no one gets it unless they said it is too expensive, and Stripe is never written`, async () => {
    const admin = makeAdmin(); const s = makeStripe();
    const r = await applyDiscount({ stripe: s.stripe, admin }, ctx, { eventId: await survey(admin, reason) });
    assert.equal(r.status, 403);
    assert.equal(writes(s.calls).length, 0);
    assert.equal(admin.t.retention_offers.length, 0);
  });
}

test("discount: refused without a survey, and for someone else's survey", async () => {
  const admin = makeAdmin(); const s = makeStripe();
  assert.equal((await applyDiscount({ stripe: s.stripe, admin }, ctx, {})).status, 400);
  const eventId = await survey(admin, "too_expensive");
  const other = { userId: "99999999-9999-4999-8999-999999999999", subscriptionId: "sub_other" };
  assert.equal((await applyDiscount({ stripe: s.stripe, admin }, other, { eventId })).status, 400);
  assert.equal(writes(s.calls).length, 0);
});

test("discount: a second request within 6 months is refused by the server, with the date it comes back", async () => {
  const admin = makeAdmin(); const s = makeStripe();
  await applyDiscount({ stripe: s.stripe, admin, now: NOW }, ctx, { eventId: await survey(admin, "too_expensive") });
  s.sub.discounts = []; // even if the first discount has been used up on an invoice
  const again = await applyDiscount({ stripe: s.stripe, admin, now: NOW }, ctx, { eventId: await survey(admin, "too_expensive") });
  assert.equal(again.status, 409);
  assert.equal(again.body.code, "discount_not_eligible");
  assert.equal(again.body.availableOn, "2027-05-01"); // 180 days after 2 Nov 2026
  assert.equal(s.calls.filter((c) => c[0] === "update").length, 1); // Stripe was written exactly once
});

test("discount: available again after 180 days", async () => {
  const admin = makeAdmin({ now: NOW }); const s = makeStripe();
  await applyDiscount({ stripe: s.stripe, admin }, ctx, { eventId: await survey(admin, "too_expensive") });
  s.sub.discounts = [];
  const later = makeAdmin({ now: NOW + 181 * DAY });
  later.t.retention_offers.push(...admin.t.retention_offers);
  later.t.cancellation_events.push(...admin.t.cancellation_events);
  const eventId = await survey(later, "too_expensive");
  assert.equal((await applyDiscount({ stripe: s.stripe, admin: later }, ctx, { eventId })).status, 200);
});

test("discount: a double click applies it once (the second is told it is already in progress or used)", async () => {
  const admin = makeAdmin(); const s = makeStripe();
  const eventId = await survey(admin, "too_expensive");
  const results = await Promise.all([applyDiscount({ stripe: s.stripe, admin }, ctx, { eventId }), applyDiscount({ stripe: s.stripe, admin }, ctx, { eventId })]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal(s.calls.filter((c) => c[0] === "update").length, 1);
});

test("discount: Stripe rejects it -> 'failed', nothing claimed done, and the failed try does not use up the 6 months", async () => {
  const admin = makeAdmin(); const s = makeStripe({ failUpdate: true });
  const r = await applyDiscount({ stripe: s.stripe, admin }, ctx, { eventId: await survey(admin, "too_expensive") });
  assert.equal(r.status, 502);
  assert.equal(r.body.status, "failed");
  assert.match(r.body.error, /Nothing was changed/);
  assert.equal(admin.t.retention_offers[0].status, "failed");
  assert.equal(admin.t.cancellation_events[0].decision, "none");
  const ok = makeStripe();
  assert.equal((await applyDiscount({ stripe: ok.stripe, admin }, ctx, { eventId: await survey(admin, "too_expensive") })).status, 200);
});

test("discount: if Stripe accepts the call but the subscription does not show the discount, it is NOT reported as done", async () => {
  const admin = makeAdmin(); const s = makeStripe({ silentNoop: true });
  const r = await applyDiscount({ stripe: s.stripe, admin }, ctx, { eventId: await survey(admin, "too_expensive") });
  assert.equal(r.status, 502);
  assert.equal(admin.t.retention_offers[0].status, "failed");
});

test("discount: refused when the subscription is cancelling, paused, inactive or already discounted", async () => {
  for (const sub of [{ cancel_at_period_end: true }, { pause_collection: { behavior: "void", resumes_at: PERIOD_END + 99 } }, { status: "past_due" },
    { discounts: [{ source: { coupon: { id: "other" } } }] }]) {
    const admin = makeAdmin(); const s = makeStripe({ sub });
    const r = await applyDiscount({ stripe: s.stripe, admin }, ctx, { eventId: await survey(admin, "too_expensive") });
    assert.equal(r.status, 409, JSON.stringify(sub));
    assert.equal(writes(s.calls).length, 0);
  }
});

test("discount: Stripe unreachable before anything starts -> clear error and nothing claimed", async () => {
  const admin = makeAdmin(); const s = makeStripe({ failRetrieve: true });
  const r = await applyDiscount({ stripe: s.stripe, admin }, ctx, { eventId: await survey(admin, "too_expensive") });
  assert.equal(r.status, 502);
  assert.equal(admin.t.retention_offers.length, 0);
});

/* ───────────── the pause ───────────── */
test("addMonthsUtc keeps the day and clamps at month end", () => {
  const d = (y, m, day) => Date.UTC(y, m, day) / 1000;
  assert.equal(addMonthsUtc(d(2026, 10, 20), 1), d(2026, 11, 20));
  assert.equal(addMonthsUtc(d(2026, 10, 20), 2), d(2027, 0, 20));
  assert.equal(addMonthsUtc(d(2027, 0, 31), 1), d(2027, 1, 28));
});

for (const months of [1, 2]) {
  test(`pause: ${months} month(s) -> paid period kept, billing voided until the exact restart date, confirmed from Stripe`, async () => {
    const admin = makeAdmin(); const s = makeStripe();
    const r = await applyPause({ stripe: s.stripe, admin }, ctx, { eventId: await survey(admin, "break"), months });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const resumes = addMonthsUtc(PERIOD_END, months);
    assert.equal(r.body.status, "confirmed");
    assert.equal(r.body.proUntil, new Date(PERIOD_END * 1000).toISOString()); // Pro until the paid period ends
    assert.equal(r.body.resumesOn, new Date(resumes * 1000).toISOString()); // the exact restart date
    assert.equal(r.body.nextAmountCents, 2800);
    const update = s.calls.find((c) => c[0] === "update");
    assert.deepEqual(update[2], { pause_collection: { behavior: "void", resumes_at: resumes } }); // no billing during the pause
    assert.equal(admin.t.retention_offers[0].offer, `pause_${months}`);
    assert.equal(admin.t.retention_offers[0].status, "confirmed");
  });
}

test("pause: 'not using' may pause too; the other answers may not; only 1 or 2 months", async () => {
  const admin = makeAdmin();
  assert.equal((await applyPause({ stripe: makeStripe().stripe, admin }, ctx, { eventId: await survey(admin, "not_using"), months: 1 })).status, 200);
  for (const reason of ["too_expensive", "not_good_clips", "other"]) {
    const s = makeStripe();
    assert.equal((await applyPause({ stripe: s.stripe, admin }, ctx, { eventId: await survey(admin, reason), months: 1 })).status, 403, reason);
    assert.equal(writes(s.calls).length, 0);
  }
  for (const months of [0, 3, "x", undefined]) {
    assert.equal((await applyPause({ stripe: makeStripe().stripe, admin }, ctx, { eventId: await survey(admin, "break"), months })).status, 400);
  }
});

test("pause: cannot pause twice, or while a cancellation is scheduled; Stripe failure or a pause Stripe does not show is 'failed'", async () => {
  const admin = makeAdmin();
  const e = await survey(admin, "break");
  assert.equal((await applyPause({ stripe: makeStripe({ sub: { pause_collection: { behavior: "void", resumes_at: 5 } } }).stripe, admin }, ctx, { eventId: e, months: 1 })).body.code, "already_paused");
  assert.equal((await applyPause({ stripe: makeStripe({ sub: { cancel_at_period_end: true } }).stripe, admin }, ctx, { eventId: e, months: 1 })).body.code, "cancellation_pending");
  for (const o of [{ failUpdate: true }, { silentNoop: true }]) {
    const a = makeAdmin(); const s = makeStripe(o);
    const r = await applyPause({ stripe: s.stripe, admin: a }, ctx, { eventId: await survey(a, "break"), months: 1 });
    assert.equal(r.status, 502);
    assert.equal(r.body.status, "failed");
    assert.equal(a.t.retention_offers[0].status, "failed");
  }
});

/* ───────────── cancelling ───────────── */
test("cancel: always possible without any offer; confirmed only after Stripe shows it; access runs to the period end", async () => {
  const admin = makeAdmin(); const s = makeStripe();
  const r = await cancelSubscription({ stripe: s.stripe, admin }, ctx, {});
  assert.equal(r.status, 200);
  assert.equal(r.body.accessUntil, new Date(PERIOD_END * 1000).toISOString());
  assert.deepEqual(s.calls.find((c) => c[0] === "update")[2], { cancel_at_period_end: true }); // ends at period end, not now
  assert.equal(s.calls.filter((c) => c[0] === "coupon.create").length, 0); // no offer applied behind their back
});

test("cancel: after a survey it records the decision and passes the reason to Stripe", async () => {
  for (const [reason, feedback] of [["not_good_clips", "low_quality"], ["too_expensive", "too_expensive"], ["not_using", "unused"], ["break", "other"], ["other", "other"]]) {
    const admin = makeAdmin(); const s = makeStripe();
    const eventId = await survey(admin, reason);
    assert.equal((await cancelSubscription({ stripe: s.stripe, admin }, ctx, { eventId })).status, 200);
    assert.equal(s.calls.find((c) => c[0] === "update")[2].cancellation_details.feedback, feedback);
    assert.equal(admin.t.cancellation_events[0].decision, "cancelled");
  }
});

test("cancel: declining an offer never blocks cancelling; no discount or pause is written on the way", async () => {
  const admin = makeAdmin(); const s = makeStripe();
  const eventId = await survey(admin, "too_expensive"); // sees the discount, declines it
  await cancelSubscription({ stripe: s.stripe, admin }, ctx, { eventId });
  assert.deepEqual(s.calls.filter((c) => c[0] === "update").map((c) => Object.keys(c[2]).sort().join()), ["cancel_at_period_end,cancellation_details"]);
  assert.equal(admin.t.retention_offers.length, 0);
});

test("cancel: a Stripe failure, or a cancellation Stripe does not show, is never reported as cancelled", async () => {
  for (const o of [{ failUpdate: true }, { silentNoop: true }]) {
    const r = await cancelSubscription({ stripe: makeStripe(o).stripe, admin: makeAdmin() }, ctx, {});
    assert.equal(r.status, 502);
    assert.equal(r.body.status, "failed");
    assert.match(r.body.error, /has not been made/);
  }
  assert.equal((await cancelSubscription({ stripe: makeStripe({ failRetrieve: true }).stripe, admin: makeAdmin() }, ctx, {})).status, 502);
});

test("cancel: repeating it is safe; undo works and is also safe to repeat", async () => {
  const s = makeStripe({ sub: { cancel_at_period_end: true } });
  const again = await cancelSubscription({ stripe: s.stripe, admin: makeAdmin() }, ctx, {});
  assert.deepEqual([again.status, again.body.already], [200, true]);
  assert.equal(s.calls.filter((c) => c[0] === "update").length, 0);
  assert.equal((await undoCancellation({ stripe: s.stripe, admin: makeAdmin() }, ctx)).status, 200);
  assert.equal(s.sub.cancel_at_period_end, false);
  assert.equal((await undoCancellation({ stripe: s.stripe, admin: makeAdmin() }, ctx)).body.already, true);
  assert.equal((await undoCancellation({ stripe: makeStripe({ sub: { cancel_at_period_end: true }, failUpdate: true }).stripe, admin: makeAdmin() }, ctx)).status, 502);
});

/* ───────────── state, delayed answers ───────────── */
test("state: reports eligibility, the next amount, pause and cancellation, straight from Stripe", async () => {
  const admin = makeAdmin(); const s = makeStripe();
  let st = (await getRetentionState({ stripe: s.stripe, admin, now: NOW }, ctx)).body;
  assert.deepEqual([st.discountEligible, st.nextAmountCents, st.paused, st.cancelAtPeriodEnd], [true, 2800, false, false]);
  await applyDiscount({ stripe: s.stripe, admin, now: NOW }, ctx, { eventId: await survey(admin, "too_expensive") });
  st = (await getRetentionState({ stripe: s.stripe, admin, now: NOW }, ctx)).body;
  assert.deepEqual([st.discountApplied, st.discountEligible, st.nextAmountCents], [true, false, 1680]);
  assert.match(st.discountAvailableOn, /^2027-/);
});

test("state: Stripe unreachable -> a plain error, never a guess", async () => {
  const r = await getRetentionState({ stripe: makeStripe({ failRetrieve: true }).stripe, admin: makeAdmin() }, ctx);
  assert.equal(r.status, 502);
});

test("delayed answer: a discount claimed but never confirmed settles itself from Stripe on the next look", async () => {
  const admin = makeAdmin(); const s = makeStripe();
  admin.t.retention_offers.push({ id: "o1", user_id: USER, offer: "discount_40", status: "pending", created_at: new Date(NOW).toISOString() });
  s.sub.discounts = [{ source: { coupon: { id: RETENTION.COUPON_ID } } }]; // Stripe did apply it; our answer was lost
  await getRetentionState({ stripe: s.stripe, admin, now: NOW }, ctx);
  assert.equal(admin.t.retention_offers[0].status, "confirmed");
});

test("delayed answer: a stale claim Stripe never applied is released after 10 minutes, so it does not block the person", async () => {
  const admin = makeAdmin(); const s = makeStripe();
  admin.t.retention_offers.push({ id: "o1", user_id: USER, offer: "discount_40", status: "pending", created_at: new Date(NOW - 20 * 60_000).toISOString() });
  await getRetentionState({ stripe: s.stripe, admin, now: NOW }, ctx);
  assert.equal(admin.t.retention_offers[0].status, "failed");
  // a fresh claim is left alone (Stripe may still be about to answer)
  const fresh = makeAdmin();
  fresh.t.retention_offers.push({ id: "o2", user_id: USER, offer: "discount_40", status: "pending", created_at: new Date(NOW - 60_000).toISOString() });
  await getRetentionState({ stripe: s.stripe, admin: fresh, now: NOW }, ctx);
  assert.equal(fresh.t.retention_offers[0].status, "pending");
});

/* ───────────── safety ───────────── */
test("safety: the module can only retrieve and update an existing subscription — it cannot create one", async () => {
  const admin = makeAdmin(); const s = makeStripe();
  const approx = s.stripe.subscriptions;
  assert.equal(typeof approx.create, "undefined");
  await runRetentionAction({ stripe: s.stripe, admin }, ctx, "cancel", {});
  assert.ok(s.calls.every((c) => ["retrieve", "update", "coupon.retrieve", "coupon.create"].includes(c[0])));
  assert.equal((await runRetentionAction({ stripe: s.stripe, admin }, ctx, "bogus", {})).status, 404);
});

/* ───────────── a paused subscriber, swept up by the daily reconcile ───────────── */
test("reconcile: a paused subscriber whose paid period has ended is moved to Free (id kept); one still inside it is untouched", async () => {
  const profile = { id: USER, tier: "pro", stripe_subscription_id: SUB };
  const admin = {
    rpc: async () => ({ error: null }),
    from() {
      const f = [];
      const q = {
        update(ch) { q.ch = ch; return q; }, select() { return q; }, eq(c, v) { f.push([c, v]); return q; },
        then(res, rej) { return Promise.resolve().then(() => {
          const hit = f.every(([c, v]) => profile[c] === v);
          if (hit) Object.assign(profile, q.ch);
          return { data: hit ? [{ id: USER }] : [], error: null };
        }).then(res, rej); },
      };
      return q;
    },
  };
  const paused = (endSeconds) => ({ subscriptions: {
    list: async () => ({ data: [{ id: SUB, status: "active", customer: "cus_1", pause_collection: { behavior: "void" }, items: { data: [{ current_period_end: endSeconds }] }, latest_invoice: null }] }),
    search: async () => ({ data: [] }),
  } });
  await syncUserFromStripe({ stripe: paused(Date.now() / 1000 + 5 * 86400), admin, userId: USER, customerId: "cus_1" });
  assert.equal(profile.tier, "pro");
  const res = await syncUserFromStripe({ stripe: paused(Date.now() / 1000 - 3600), admin, userId: USER, customerId: "cus_1" });
  assert.equal(profile.tier, "free");
  assert.equal(profile.stripe_subscription_id, SUB);
  assert.equal(res.outcomes[0].action, "revoked");
});

test("cancel -> undo -> cancel again in the same period works (cancel and undo are plain switches with no replayed idempotency key)", async () => {
  const s = makeStripe();
  const admin = makeAdmin();
  assert.equal((await cancelSubscription({ stripe: s.stripe, admin }, ctx, {})).status, 200);
  assert.equal((await undoCancellation({ stripe: s.stripe, admin }, ctx)).status, 200);
  assert.equal((await cancelSubscription({ stripe: s.stripe, admin }, ctx, {})).status, 200);
  assert.equal(s.sub.cancel_at_period_end, true);
  for (const call of s.calls.filter((c) => c[0] === "update")) assert.equal(call[3], undefined);
});
