import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { validateProPrice } from "../lib/checkout-price.ts";
import { MONTHLY_PRICE_USD, YEARLY_PER_MONTH_USD, YEARLY_PRICE_USD, YEARLY_SAVE_PERCENT } from "../lib/pricing.ts";
import { refillYearlySparks } from "../lib/yearly-refill.ts";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 2);
const USER = "11111111-1111-4111-8111-111111111111";
const SUB = "sub_yearly";

/* ---------- the advertised numbers ---------- */
test("the public yearly price: $276 a year = $23 a month = 18% off twelve $28 payments", () => {
  assert.equal(MONTHLY_PRICE_USD, 28);
  assert.equal(YEARLY_PRICE_USD, 276);
  assert.equal(YEARLY_PER_MONTH_USD, 23);
  assert.equal(YEARLY_SAVE_PERCENT, 18);
  assert.equal(YEARLY_PRICE_USD, YEARLY_PER_MONTH_USD * 12); // exactly $23 x 12, so "$23/mo" is honest
});

test("checkout cents match the public prices", async () => {
  const src = await readFile(new URL("../lib/stripe.ts", import.meta.url), "utf8");
  assert.match(src, /PRO_PRICE_CENTS = 2800/);
  assert.match(src, new RegExp(`PRO_YEARLY_PRICE_CENTS = ${YEARLY_PRICE_USD * 100}`));
});

test("a Stripe price is accepted as yearly only if it is $276 USD billed yearly; monthly stays the default", () => {
  const price = (amount, interval) => ({ active: true, unit_amount: amount, currency: "usd", recurring: { interval } });
  assert.equal(validateProPrice(price(27600, "year"), 27600, "year"), true);
  assert.equal(validateProPrice(price(2800, "month"), 27600, "year"), false);
  assert.equal(validateProPrice(price(27600, "month"), 27600, "year"), false);
  assert.equal(validateProPrice(price(27500, "year"), 27600, "year"), false);
  assert.equal(validateProPrice(price(2800, "month"), 2800), true); // old call shape unchanged
  assert.equal(validateProPrice(price(27600, "year"), 2800), false); // a yearly price can never pass as the monthly one
});

/* ---------- the monthly refill job (Stripe and the database faked) ---------- */
function fakeAdmin({ rows = [], rpc = async () => ({ data: true, error: null }) } = {}) {
  const calls = { rpc: [], filters: [] };
  const q = {
    select() { return q; },
    eq(c, v) { calls.filters.push(["eq", c, v]); return q; },
    not(c, op, v) { calls.filters.push(["not", c, op, v]); return q; },
    lte(c, v) { calls.filters.push(["lte", c, v]); return q; },
    limit() { return Promise.resolve({ data: rows, error: null }); },
  };
  return { calls, from: () => q, rpc: async (fn, args) => { calls.rpc.push([fn, args]); return rpc(fn, args); } };
}
const stripeWith = (subs) => ({ subscriptions: { retrieve: async (id) => { if (subs[id] instanceof Error) throw subs[id]; return subs[id]; } } });
const yearlySub = (status = "active", interval = "year") => ({ id: SUB, status, items: { data: [{ price: { recurring: { interval } } }] } });
const row = (resetAt = "2026-11-01T00:00:00.000Z", sub = SUB, id = USER) => ({ id, stripe_subscription_id: sub, sparks_reset_at: resetAt });

test("refill: asks only for yearly Pro profiles whose refill date has passed", async () => {
  const admin = fakeAdmin();
  await refillYearlySparks({ stripe: stripeWith({}), admin, now: NOW });
  const f = JSON.stringify(admin.calls.filters);
  assert.match(f, /"eq","tier","pro"/);
  assert.match(f, /"eq","billing_interval","year"/);
  assert.match(f, /"lte","sparks_reset_at"/);
});

test("refill: an active yearly subscriber gets exactly 500 Sparks and a reset date 30 days out, with a unique reference", async () => {
  const admin = fakeAdmin({ rows: [row()] });
  const s = await refillYearlySparks({ stripe: stripeWith({ [SUB]: yearlySub() }), admin, now: NOW });
  assert.deepEqual([s.checked, s.granted, s.skipped, s.failed], [1, 1, 0, 0]);
  const [fn, args] = admin.calls.rpc[0];
  assert.equal(fn, "refill_yearly_sparks");
  assert.equal(args.p_balance, 500);
  assert.equal(args.p_reset_at, new Date(NOW + 30 * DAY).toISOString());
  assert.equal(args.p_reference, `yearly-refill:${SUB}:2026-11-01T00:00:00.000Z`);
});

test("refill: the same month is never granted twice (the database refuses the second grant)", async () => {
  let used = false;
  const rpc = async () => (used ? { error: { code: "23505", message: "duplicate" } } : ((used = true), { data: true, error: null }));
  const admin = fakeAdmin({ rows: [row()], rpc });
  const stripe = stripeWith({ [SUB]: yearlySub() });
  assert.equal((await refillYearlySparks({ stripe, admin, now: NOW })).granted, 1);
  const again = await refillYearlySparks({ stripe, admin, now: NOW });
  assert.deepEqual([again.granted, again.skipped, again.failed], [0, 1, 0]);
});

test("refill: nothing for a subscription that ended, is unpaid, or is no longer yearly (the webhook handles those)", async () => {
  for (const sub of [yearlySub("canceled"), yearlySub("past_due"), yearlySub("unpaid"), yearlySub("active", "month")]) {
    const admin = fakeAdmin({ rows: [row()] });
    const s = await refillYearlySparks({ stripe: stripeWith({ [SUB]: sub }), admin, now: NOW });
    assert.deepEqual([s.granted, s.skipped], [0, 1], `${sub.status}/${sub.items.data[0].price.recurring.interval}`);
    assert.equal(admin.calls.rpc.length, 0);
  }
});

test("refill: a subscription scheduled to cancel at the end of the year still gets its monthly Sparks (they paid for the year)", async () => {
  const admin = fakeAdmin({ rows: [row()] });
  const sub = { ...yearlySub(), cancel_at_period_end: true };
  assert.equal((await refillYearlySparks({ stripe: stripeWith({ [SUB]: sub }), admin, now: NOW })).granted, 1);
});

test("refill: one failing customer does not stop the others, and the failure is reported", async () => {
  const rows = [row("2026-11-01T00:00:00.000Z", "sub_bad", "u-bad"), row("2026-11-01T00:00:00.000Z", SUB, USER)];
  const admin = fakeAdmin({ rows });
  const stripe = stripeWith({ sub_bad: new Error("stripe down"), [SUB]: yearlySub() });
  const s = await refillYearlySparks({ stripe, admin, now: NOW });
  assert.deepEqual([s.checked, s.granted, s.failed], [2, 1, 1]);
  assert.equal(s.errors[0].userId, "u-bad");
});

test("refill: a database error on one customer is a failure, not a silent skip", async () => {
  const admin = fakeAdmin({ rows: [row()], rpc: async () => ({ error: { message: "boom" } }) });
  const s = await refillYearlySparks({ stripe: stripeWith({ [SUB]: yearlySub() }), admin, now: NOW });
  assert.deepEqual([s.granted, s.failed], [0, 1]);
});

/* ---------- migration 041 on a real (in-memory) Postgres ---------- */
async function database() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    create table public.profiles (
      id uuid primary key, tier text not null default 'free', sparks integer not null default 60,
      sparks_reset_at timestamptz not null default now() + interval '30 days',
      stripe_customer_id text, stripe_subscription_id text
    );
    create function public.tier_allowance(t text) returns integer language sql immutable
      as $$ select case t when 'pro' then 500 else 60 end $$;
    insert into public.profiles (id, tier, sparks, sparks_reset_at, stripe_subscription_id)
      values ('${USER}', 'pro', 120, now() - interval '1 day', '${SUB}');
  `);
  await db.exec(await readFile(new URL("../supabase/migrations/012_sparks_ledger.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../supabase/migrations/041_yearly_plan.sql", import.meta.url), "utf8"));
  return db;
}
const refill = (db, ref = "yearly-refill:a", sub = SUB, user = USER) =>
  db.query("select public.refill_yearly_sparks($1, $2, $3, 500, now() + interval '30 days') as granted", [user, sub, ref]);
const profile = async (db) => (await db.query("select * from public.profiles where id = $1", [USER])).rows[0];

test("SQL: profiles default to monthly, and only 'month' or 'year' are accepted", async () => {
  const db = await database();
  try {
    assert.equal((await profile(db)).billing_interval, "month");
    await db.query("update public.profiles set billing_interval = 'year'");
    await assert.rejects(db.query("update public.profiles set billing_interval = 'weekly'"), /violates check/);
  } finally { await db.close(); }
});

test("SQL: a due yearly Pro gets 500 Sparks once, with a ledger row; the same reference again is refused", async () => {
  const db = await database();
  try {
    await db.query("update public.profiles set billing_interval = 'year'");
    assert.equal((await refill(db)).rows[0].granted, true);
    const p = await profile(db);
    assert.equal(p.sparks, 500);
    assert.ok(new Date(p.sparks_reset_at).getTime() > Date.now() + 25 * DAY);
    const ledger = await db.query("select delta, reference from public.spark_transactions where reason = 'invoice_grant'");
    assert.deepEqual(ledger.rows.map((r) => [r.delta, r.reference]), [[380, "yearly-refill:a"]]);
    await db.query("update public.profiles set sparks_reset_at = now() - interval '1 hour'"); // due again
    await assert.rejects(refill(db), /duplicate|unique/i); // same reference: refused
    assert.equal((await refill(db, "yearly-refill:b")).rows[0].granted, true); // next month's reference works
  } finally { await db.close(); }
});

test("SQL: no refill when not yearly, not Pro, a different subscription, or not due yet", async () => {
  const db = await database();
  try {
    assert.equal((await refill(db, "r1")).rows[0].granted, false); // still monthly
    await db.query("update public.profiles set billing_interval = 'year'");
    assert.equal((await refill(db, "r2", "sub_other")).rows[0].granted, false); // other subscription
    await db.query("update public.profiles set tier = 'free'");
    assert.equal((await refill(db, "r3")).rows[0].granted, false); // not Pro
    await db.query("update public.profiles set tier = 'pro', sparks_reset_at = now() + interval '10 days'");
    assert.equal((await refill(db, "r4")).rows[0].granted, false); // not due
    assert.equal((await profile(db)).sparks, 120); // untouched throughout
    const n = await db.query("select count(*)::int as n from public.spark_transactions where reason = 'invoice_grant'");
    assert.equal(n.rows[0].n, 0);
  } finally { await db.close(); }
});

test("SQL: twelve months in a row each grant once; only the server (service role) may call the function", async () => {
  const db = await database();
  try {
    await db.query("update public.profiles set billing_interval = 'year'");
    for (let month = 1; month <= 11; month++) {
      await db.query("update public.profiles set sparks = 10, sparks_reset_at = now() - interval '1 hour'");
      assert.equal((await refill(db, `yearly-refill:${month}`)).rows[0].granted, true, `month ${month}`);
      assert.equal((await profile(db)).sparks, 500);
    }
    const n = await db.query("select count(*)::int as n from public.spark_transactions where reason = 'invoice_grant'");
    assert.equal(n.rows[0].n, 11);
    const priv = async (role) => (await db.query(`select has_function_privilege('${role}', 'public.refill_yearly_sparks(uuid,text,text,integer,timestamptz)', 'execute') as ok`)).rows[0].ok;
    assert.deepEqual([await priv("anon"), await priv("authenticated"), await priv("service_role")], [false, false, true]);
  } finally { await db.close(); }
});
