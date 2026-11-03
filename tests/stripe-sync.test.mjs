import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";
import { syncUserFromStripe, reconcileStuckPro } from "../lib/stripe-sync.ts";
import { rateLimit, resetRateLimits } from "../lib/request-rate-limit.ts";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const DAY = 86_400_000;

/** The real grant_tier_sparks (migration 012) on in-memory Postgres, behind a thin Supabase-shaped adapter. */
async function database() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    create table public.profiles (
      id uuid primary key, tier text not null default 'free',
      sparks integer not null default 60,
      sparks_reset_at timestamptz not null default now() + interval '30 days',
      stripe_customer_id text, stripe_subscription_id text,
      billing_interval text not null default 'month'
    );
    create function public.tier_allowance(t text) returns integer language sql immutable
      as $$ select case t when 'pro' then 500 else 60 end $$;
    insert into public.profiles (id) values ('${USER}'), ('${OTHER}');
  `);
  await db.exec(await readFile(new URL("../supabase/migrations/012_sparks_ledger.sql", import.meta.url), "utf8"));

  const calls = { rpc: [] };
  const admin = {
    async rpc(fn, args) {
      calls.rpc.push([fn, args]);
      try {
        const keys = Object.keys(args);
        const r = await db.query(`select public."${fn}"(${keys.map((k, i) => `"${k}" => $${i + 1}`).join(", ")})`, keys.map((k) => args[k]));
        return { data: r.rows[0], error: null };
      } catch (e) {
        return { data: null, error: { code: e.code, message: e.message } };
      }
    },
    from(table) {
      assert.equal(table, "profiles");
      const f = { eq: [], notNull: [], lt: [], limit: null, update: null };
      const q = {
        update(changes) { f.update = changes; return q; },
        select() { return q; },
        eq(c, v) { f.eq.push([c, v]); return q; },
        not(c, op, v) { assert.equal(op, "is"); assert.equal(v, null); f.notNull.push(c); return q; },
        lt(c, v) { f.lt.push([c, v]); return q; },
        limit(n) { f.limit = n; return q; },
        then(resolve, reject) {
          return (async () => {
            const where = [...f.eq.map(([c], i) => `"${c}" = $${i + 1}`)];
            const vals = f.eq.map(([, v]) => v);
            f.notNull.forEach((c) => where.push(`"${c}" is not null`));
            f.lt.forEach(([c, v]) => { vals.push(v); where.push(`"${c}" < $${vals.length}`); });
            const w = where.length ? `where ${where.join(" and ")}` : "";
            if (f.update) {
              const cols = Object.keys(f.update);
              const r = await db.query(`update public.profiles set ${cols.map((c, i) => `"${c}" = $${vals.length + i + 1}`).join(", ")} ${w} returning id`,
                [...vals, ...cols.map((c) => f.update[c])]);
              return { data: r.rows, error: null };
            }
            const r = await db.query(`select id, stripe_customer_id from public.profiles ${w} ${f.limit ? `limit ${f.limit}` : ""}`, vals);
            return { data: r.rows, error: null };
          })().then(resolve, reject);
        },
      };
      return q;
    },
  };
  const profile = async (id = USER) => (await db.query("select * from public.profiles where id = $1", [id])).rows[0];
  const ledger = async (reason = "invoice_grant", id = USER) =>
    (await db.query("select reference, delta from public.spark_transactions where user_id = $1 and reason = $2", [id, reason])).rows;
  return { db, admin, calls, profile, ledger };
}

const invoice = (id, reason = "subscription_cycle", status = "paid") => ({ id, status, billing_reason: reason });
const sub = (id, status, latest, customer = "cus_1") => ({ id, status, customer, latest_invoice: latest });
function fakeStripe({ subs = [], failFor = null } = {}) {
  const calls = [];
  return {
    calls, set: (s) => { subs = s; },
    subscriptions: {
      async list(p) { calls.push(["list", p]); if (failFor && p.customer === failFor) throw new Error("stripe down"); return { data: subs }; },
      async search(p) { calls.push(["search", p]); return { data: subs }; },
    },
  };
}
const syncUser = (ctx, stripe, userId = USER, customerId = "cus_1") =>
  syncUserFromStripe({ stripe, admin: ctx.admin, userId, customerId });

test("a missed checkout webhook is repaired: Pro and exactly 500 Sparks", async () => {
  const ctx = await database();
  try {
    const stripe = fakeStripe({ subs: [sub("sub_1", "active", invoice("in_1", "subscription_create"))] });
    const res = await syncUser(ctx, stripe);
    assert.deepEqual(res.outcomes, [{ subscriptionId: "sub_1", action: "granted" }]);
    const p = await ctx.profile();
    assert.deepEqual([p.tier, p.sparks, p.stripe_subscription_id, p.stripe_customer_id], ["pro", 500, "sub_1", "cus_1"]);
    assert.deepEqual((await ctx.ledger()).map((r) => r.reference), ["in_1"]);
  } finally { await ctx.db.close(); }
});

test("running the sync again never grants again or refills spent Sparks", async () => {
  const ctx = await database();
  try {
    const stripe = fakeStripe({ subs: [sub("sub_1", "active", invoice("in_1", "subscription_create"))] });
    await syncUser(ctx, stripe);
    await ctx.db.query("update public.profiles set sparks = 123 where id = $1", [USER]);
    for (let i = 0; i < 3; i++) {
      const res = await syncUser(ctx, stripe);
      assert.equal(res.outcomes[0].action, "already_granted");
    }
    assert.equal((await ctx.profile()).sparks, 123);
    assert.equal((await ctx.ledger()).length, 1);
  } finally { await ctx.db.close(); }
});

test("the webhook and the sync grant the same invoice only once, in either order", async () => {
  const ctx = await database();
  try {
    // The webhook's own grantTier call for invoice in_2.
    const webhookGrant = (uid, invoiceId) => ctx.admin.rpc("grant_tier_sparks", {
      p_user_id: uid, p_match_customer_id: null, p_tier: "pro", p_balance: 500,
      p_reset_at: new Date(Date.now() + 30 * DAY).toISOString(), p_event_id: invoiceId, p_reason: "invoice_grant",
      p_customer_id: "cus_1", p_subscription_id: "sub_1", p_set_subscription: true });
    const stripe = fakeStripe({ subs: [sub("sub_1", "active", invoice("in_2"))] });

    // webhook first, then the sync after the user spent some Sparks
    assert.equal((await webhookGrant(USER, "in_2")).error, null);
    await ctx.db.query("update public.profiles set sparks = 200 where id = $1", [USER]);
    assert.equal((await syncUser(ctx, stripe)).outcomes[0].action, "already_granted");
    assert.equal((await ctx.profile()).sparks, 200);

    // sync first, then a late webhook retry for the same invoice
    assert.equal((await syncUser(ctx, stripe, OTHER)).outcomes[0].action, "granted");
    await ctx.db.query("update public.profiles set sparks = 77 where id = $1", [OTHER]);
    assert.equal((await webhookGrant(OTHER, "in_2")).error.code, "23505"); // the webhook swallows exactly this
    assert.equal((await ctx.profile(OTHER)).sparks, 77);
  } finally { await ctx.db.close(); }
});

test("a missed RENEWAL is repaired with exactly one new 500 grant", async () => {
  const ctx = await database();
  try {
    const stripe = fakeStripe({ subs: [sub("sub_1", "active", invoice("in_1", "subscription_create"))] });
    await syncUser(ctx, stripe);
    await ctx.db.query("update public.profiles set sparks = 9 where id = $1", [USER]); // spent; renewal webhook never came
    stripe.set([sub("sub_1", "active", invoice("in_2", "subscription_cycle"))]);
    await syncUser(ctx, stripe);
    await syncUser(ctx, stripe);
    assert.equal((await ctx.profile()).sparks, 500);
    assert.equal((await ctx.ledger()).length, 2);
  } finally { await ctx.db.close(); }
});

test("a missed CANCELLATION is repaired: Pro is revoked, the Sparks left stay", async () => {
  const ctx = await database();
  try {
    const stripe = fakeStripe({ subs: [sub("sub_1", "active", invoice("in_1", "subscription_create"))] });
    await syncUser(ctx, stripe);
    await ctx.db.query("update public.profiles set sparks = 321 where id = $1", [USER]);
    stripe.set([sub("sub_1", "canceled", invoice("in_1"))]);
    const res = await syncUser(ctx, stripe);
    assert.equal(res.outcomes[0].action, "revoked");
    const p = await ctx.profile();
    assert.deepEqual([p.tier, p.stripe_subscription_id, p.sparks], ["free", null, 321]);
  } finally { await ctx.db.close(); }
});

test("past_due and unpaid subscriptions lose Pro like the webhook does, and a later paid invoice restores it", async () => {
  const ctx = await database();
  try {
    const stripe = fakeStripe({ subs: [sub("sub_1", "active", invoice("in_1", "subscription_create"))] });
    await syncUser(ctx, stripe);
    for (const status of ["past_due", "unpaid"]) {
      await ctx.db.query("update public.profiles set tier = 'pro', stripe_subscription_id = 'sub_1' where id = $1", [USER]);
      stripe.set([sub("sub_1", status, invoice("in_x", "subscription_cycle", "open"))]);
      assert.equal((await syncUser(ctx, stripe)).outcomes[0].action, "revoked", status);
      assert.equal((await ctx.profile()).tier, "free", status);
    }
    stripe.set([sub("sub_1", "active", invoice("in_3", "subscription_cycle"))]);
    await syncUser(ctx, stripe);
    const p = await ctx.profile();
    assert.deepEqual([p.tier, p.sparks, p.stripe_subscription_id], ["pro", 500, "sub_1"]);
  } finally { await ctx.db.close(); }
});

test("an OLD subscription's cancellation never touches the customer's NEW subscription", async () => {
  const ctx = await database();
  try {
    await ctx.db.query("update public.profiles set tier = 'pro', stripe_subscription_id = 'sub_new', sparks = 400 where id = $1", [USER]);
    const stripe = fakeStripe({ subs: [sub("sub_old", "canceled", invoice("in_old"))] });
    const res = await syncUser(ctx, stripe);
    assert.equal(res.outcomes[0].action, "unchanged");
    const p = await ctx.profile();
    assert.deepEqual([p.tier, p.stripe_subscription_id, p.sparks], ["pro", "sub_new", 400]);
  } finally { await ctx.db.close(); }
});

test("nothing is granted for an unpaid invoice, a mid-period invoice, or a missing invoice", async () => {
  const ctx = await database();
  try {
    for (const latest of [invoice("in_a", "subscription_cycle", "open"), invoice("in_b", "subscription_update"), invoice("in_c", "manual"), null, "in_unexpanded"]) {
      const stripe = fakeStripe({ subs: [sub("sub_1", "active", latest)] });
      assert.equal((await syncUser(ctx, stripe)).outcomes[0].action, "unchanged");
    }
    const p = await ctx.profile();
    assert.deepEqual([p.tier, p.sparks], ["free", 60]);
  } finally { await ctx.db.close(); }
});

test("with no customer id yet, the subscription is found by the user_id metadata search", async () => {
  const ctx = await database();
  try {
    const stripe = fakeStripe({ subs: [sub("sub_s", "active", invoice("in_s", "subscription_create"), "cus_found")] });
    await syncUser(ctx, stripe, USER, null);
    assert.equal(stripe.calls[0][0], "search");
    assert.match(stripe.calls[0][1].query, new RegExp(`metadata\\['user_id'\\]:'${USER}'`));
    assert.equal((await ctx.profile()).stripe_customer_id, "cus_found");
  } finally { await ctx.db.close(); }
});

test("a malformed user id never reaches Stripe", async () => {
  const ctx = await database();
  try {
    const stripe = fakeStripe();
    await assert.rejects(syncUserFromStripe({ stripe, admin: ctx.admin, userId: "x' OR metadata['a']:'b", customerId: null }), /invalid user id/);
    assert.equal(stripe.calls.length, 0);
  } finally { await ctx.db.close(); }
});

test("a Stripe outage fails loudly and changes nothing", async () => {
  const ctx = await database();
  try {
    await ctx.db.query("update public.profiles set sparks = 33 where id = $1", [USER]);
    await assert.rejects(syncUser(ctx, fakeStripe({ failFor: "cus_1" })), /stripe down/);
    assert.equal((await ctx.profile()).sparks, 33);
  } finally { await ctx.db.close(); }
});

/* ── the daily sweep ── */
test("reconcile checks only Pro subscribers whose renewal date is >2 days past, and survives one failing customer", async () => {
  const ctx = await database();
  try {
    const now = Date.now();
    await ctx.db.query(`update public.profiles set tier = 'pro', stripe_subscription_id = 'sub_stuck', stripe_customer_id = 'cus_stuck',
      sparks = 5, sparks_reset_at = $2 where id = $1`, [USER, new Date(now - 5 * DAY).toISOString()]);
    await ctx.db.query(`update public.profiles set tier = 'pro', stripe_subscription_id = 'sub_bad', stripe_customer_id = 'cus_bad',
      sparks_reset_at = $2 where id = $1`, [OTHER, new Date(now - 6 * DAY).toISOString()]);
    const healthy = "33333333-3333-4333-8333-333333333333";
    await ctx.db.query(`insert into public.profiles (id, tier, stripe_subscription_id, stripe_customer_id, sparks_reset_at)
      values ($1, 'pro', 'sub_ok', 'cus_ok', $2)`, [healthy, new Date(now + 10 * DAY).toISOString()]);
    const comped = "44444444-4444-4444-8444-444444444444";
    await ctx.db.query(`insert into public.profiles (id, tier, sparks_reset_at) values ($1, 'pro', $2)`, [comped, new Date(now - 9 * DAY).toISOString()]);

    const stripe = fakeStripe({ failFor: "cus_bad", subs: [sub("sub_stuck", "active", invoice("in_renew"), "cus_stuck")] });
    const summary = await reconcileStuckPro({ stripe, admin: ctx.admin, now });
    assert.equal(summary.checked, 2, "healthy and complimentary (no subscription) Pro accounts are never checked");
    assert.equal(summary.failed, 1);
    assert.equal(summary.errors[0].userId, OTHER);
    assert.equal(summary.changed, 1);
    assert.equal((await ctx.profile(USER)).sparks, 500); // renewal grant recovered
    assert.equal(stripe.calls.some(([, p]) => p.customer === "cus_ok"), false);
  } finally { await ctx.db.close(); }
});

test("a second sweep finds nothing left to change", async () => {
  const ctx = await database();
  try {
    const now = Date.now();
    await ctx.db.query(`update public.profiles set tier = 'pro', stripe_subscription_id = 'sub_1', stripe_customer_id = 'cus_1',
      sparks = 5, sparks_reset_at = $2 where id = $1`, [USER, new Date(now - 5 * DAY).toISOString()]);
    const stripe = fakeStripe({ subs: [sub("sub_1", "active", invoice("in_renew"), "cus_1")] });
    await reconcileStuckPro({ stripe, admin: ctx.admin, now });
    await ctx.db.query("update public.profiles set sparks = 250, sparks_reset_at = $2 where id = $1", [USER, new Date(now - 5 * DAY).toISOString()]);
    const again = await reconcileStuckPro({ stripe, admin: ctx.admin, now });
    assert.equal(again.changed, 0);
    assert.equal((await ctx.profile()).sparks, 250);
  } finally { await ctx.db.close(); }
});

/* ── routes ── */
const transpile = (path) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const reconcileCode = transpile("../app/api/stripe/reconcile/route.ts");

function reconcileRoute({ secret = "s3cret", summary } = {}) {
  const calls = { reconcile: 0 };
  const response = class extends Response { static json(v, i) { return new this(JSON.stringify(v), i); } };
  const modules = {
    "node:crypto": { timingSafeEqual: (a, b) => a.equals(b) },
    "next/server": { NextResponse: response },
    "@/lib/stripe": { getStripe: () => ({}) },
    "@/lib/supabase/admin": { createAdminClient: () => ({}) },
    "@/lib/yearly-refill": { refillYearlySparks: async () => ({ checked: 0, granted: 0, skipped: 0, failed: 0, errors: [] }) },
    "@/lib/stripe-sync": { reconcileStuckPro: async () => { calls.reconcile++; return summary ?? { checked: 0, changed: 0, failed: 0, errors: [] }; } },
  };
  const exports = {};
  vm.runInNewContext(reconcileCode, { exports, require: (n) => { if (!(n in modules)) throw new Error(`Unexpected import: ${n}`); return modules[n]; },
    process: { env: secret === null ? {} : { CRON_SECRET: secret } }, Buffer, console });
  const req = (authorization) => ({ headers: { get: (h) => (h.toLowerCase() === "authorization" ? authorization ?? null : null) } });
  return { calls, GET: (a) => exports.GET(req(a)), POST: (a) => exports.POST(req(a)) };
}

test("reconcile route: refuses without the secret, with a wrong one, and when no secret is configured", async () => {
  const h = reconcileRoute();
  assert.equal((await h.GET(undefined)).status, 401);
  assert.equal((await h.GET("Bearer wrong")).status, 401);
  assert.equal((await h.POST("Bearer s3cret-but-longer")).status, 401);
  assert.equal(h.calls.reconcile, 0);
  const unset = reconcileRoute({ secret: null });
  assert.equal((await unset.GET("Bearer anything")).status, 503);
  assert.equal(unset.calls.reconcile, 0);
});

test("reconcile route: runs with the right secret and returns the summary", async () => {
  const h = reconcileRoute({ summary: { checked: 3, changed: 1, failed: 0, errors: [] } });
  const res = await h.GET("Bearer s3cret");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, checked: 3, changed: 1, failed: 0, errors: [], yearlyRefill: { checked: 0, granted: 0, skipped: 0, failed: 0, errors: [] } });
  assert.equal(h.calls.reconcile, 1);
});

test("rate limiter: allows the limit, refuses the next, and recovers after the window", () => {
  resetRateLimits();
  const t0 = 1_000_000;
  for (let i = 0; i < 6; i++) assert.equal(rateLimit("u", 6, 60_000, t0 + i).ok, true);
  const blocked = rateLimit("u", 6, 60_000, t0 + 10);
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfterSeconds >= 1 && blocked.retryAfterSeconds <= 60);
  assert.equal(rateLimit("other", 6, 60_000, t0 + 10).ok, true);
  assert.equal(rateLimit("u", 6, 60_000, t0 + 61_000).ok, true);
});
