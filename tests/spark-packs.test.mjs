import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";
import { DEFAULT_PACK_ID, SPARK_PACKS, isPackSession, packById, packForSession } from "../lib/spark-packs.ts";
import { syncSparkPacks } from "../lib/spark-packs-sync.ts";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

/* ---------- the catalogue ---------- */
test("the three packs: 100 for $8, 250 for $18, 500 for $33", () => {
  assert.deepEqual(SPARK_PACKS.map((p) => [p.id, p.sparks, p.cents]), [["p100", 100, 800], ["p250", 250, 1800], ["p500", 500, 3300]]);
  assert.equal(DEFAULT_PACK_ID, "p250");
  assert.equal(packById("p250").sparks, 250);
  for (const bad of ["p999", "", undefined, null, 250, "P250"]) assert.equal(packById(bad), undefined, String(bad));
});

test("packs always cost more per Spark than the Pro plan ($28 for 500), so Pro stays the best value", () => {
  const proPerSpark = 2800 / 500;
  for (const p of SPARK_PACKS) assert.ok(p.cents / p.sparks > proPerSpark, p.id);
});

test("a session is only a pack when it is a one-time payment tagged as a pack", () => {
  assert.equal(isPackSession({ mode: "payment", metadata: { kind: "spark_pack" } }), true);
  assert.equal(isPackSession({ mode: "subscription", metadata: { kind: "spark_pack" } }), false);
  assert.equal(isPackSession({ mode: "payment", metadata: { kind: "other" } }), false);
  assert.equal(isPackSession({ mode: "payment" }), false);
});

test("the pack a session paid for needs the id AND the amount to agree (no more Sparks than were paid for)", () => {
  assert.equal(packForSession({ amount_total: 1800, currency: "usd", metadata: { pack: "p250" } }).sparks, 250);
  assert.equal(packForSession({ amount_total: 800, currency: "usd", metadata: { pack: "p500" } }), undefined); // paid $8, claims 500
  assert.equal(packForSession({ amount_total: 3300, currency: "usd", metadata: { pack: "p100" } }), undefined); // overpaid is also refused, not guessed at
  assert.equal(packForSession({ amount_total: 1800, currency: "eur", metadata: { pack: "p250" } }), undefined);
  assert.equal(packForSession({ amount_total: 1800, metadata: {} }), undefined);
});

/* ---------- the checkout route (one-time payment) ---------- */
const transpile = (file) => ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const routeCode = transpile("../app/api/stripe/packs/route.ts");
class NextResponse extends Response { static json(body, init) { return new NextResponse(JSON.stringify(body), init); } }

function routeHarness({ signedIn = true, customer = null } = {}) {
  let created;
  const modules = {
    "next/server": { NextResponse },
    "@/lib/stripe": { getStripe: () => ({ checkout: { sessions: { create: async (a) => { created = a; return { url: "https://checkout.stripe.com/pack" }; } } } }) },
    "@/lib/supabase/server": { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: signedIn ? { id: "user-1", email: "a@b.test" } : null } }) } }) },
    "@/lib/profile": { getProfile: async () => ({ stripe_customer_id: customer }) },
    "@/lib/spark-packs": { packById },
  };
  const exports = {};
  vm.runInNewContext(routeCode, { exports, require: (n) => modules[n], Response, Error, console, Date });
  return { post: (body) => exports.POST({ nextUrl: { origin: "https://www.klyp.world" }, json: async () => body }), get created() { return created; } };
}

test("buying a pack opens a one-time Stripe payment for exactly that pack, tagged with who bought what", async () => {
  for (const pack of SPARK_PACKS) {
    const h = routeHarness();
    const res = await h.post({ pack: pack.id });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).url, "https://checkout.stripe.com/pack");
    assert.equal(h.created.mode, "payment"); // not a subscription
    assert.equal(h.created.line_items[0].price_data.unit_amount, pack.cents);
    assert.equal(h.created.line_items[0].quantity, 1);
    assert.deepEqual({ ...h.created.metadata }, { kind: "spark_pack", user_id: "user-1", pack: pack.id });
    assert.equal(h.created.client_reference_id, "user-1");
    assert.equal(h.created.success_url, "https://www.klyp.world/dashboard?pack=1");
  }
});

test("buying a pack needs a signed-in user and a real pack; the price is never taken from the request", async () => {
  assert.equal((await routeHarness({ signedIn: false }).post({ pack: "p250" })).status, 401);
  for (const body of [{}, { pack: "p9999" }, { pack: "p250", cents: 1 }, { sparks: 500 }]) {
    const h = routeHarness();
    const res = await h.post(body);
    if (body.pack === "p250") { assert.equal(res.status, 200); assert.equal(h.created.line_items[0].price_data.unit_amount, 1800); }
    else { assert.equal(res.status, 400); assert.equal(h.created, undefined); }
  }
});

test("an existing Stripe customer is reused; a new one is created from the email otherwise", async () => {
  const a = routeHarness({ customer: "cus_1" }); await a.post({ pack: "p100" });
  assert.equal(a.created.customer, "cus_1");
  const b = routeHarness(); await b.post({ pack: "p100" });
  assert.equal(b.created.customer_email, "a@b.test");
  assert.equal(b.created.customer, undefined);
});

/* ---------- the repair sync for a missed webhook ---------- */
const paid = (id, over = {}) => ({ id, mode: "payment", payment_status: "paid", status: "complete", client_reference_id: USER, amount_total: 1800, currency: "usd",
  metadata: { kind: "spark_pack", user_id: USER, pack: "p250" }, ...over });
function packAdmin(used = new Set()) {
  const calls = [];
  return { calls, rpc: async (fn, a) => { calls.push([fn, a]); if (used.has(a.p_reference)) return { error: { code: "23505", message: "dup" } }; used.add(a.p_reference); return { error: null }; } };
}
const stripeWithSessions = (data) => ({ checkout: { sessions: { list: async (p) => { stripeWithSessions.lastParams = p; return { data }; } } } });

test("repair: a paid pack the webhook never delivered is credited, once, no matter how often the sync runs", async () => {
  const admin = packAdmin();
  const stripe = stripeWithSessions([paid("cs_1")]);
  assert.deepEqual(await syncSparkPacks({ stripe, admin, userId: USER }), { credited: 1, alreadyCredited: 0 });
  assert.deepEqual(await syncSparkPacks({ stripe, admin, userId: USER }), { credited: 0, alreadyCredited: 1 });
  assert.deepEqual(admin.calls[0], ["add_pack_sparks", { p_user_id: USER, p_sparks: 250, p_reference: "cs_1" }]);
  assert.equal(stripeWithSessions.lastParams.created.gte > 0, true);
});

test("repair: the webhook and the sync share one reference, so whichever is first wins and the other is a no-op", async () => {
  const used = new Set(["cs_1"]); // the webhook already credited it
  const admin = packAdmin(used);
  assert.deepEqual(await syncSparkPacks({ stripe: stripeWithSessions([paid("cs_1")]), admin, userId: USER }), { credited: 0, alreadyCredited: 1 });
});

test("repair: only this person's own, paid, completed, correctly-priced pack sessions count", async () => {
  const admin = packAdmin();
  const stripe = stripeWithSessions([
    paid("cs_other_user", { metadata: { kind: "spark_pack", user_id: OTHER, pack: "p250" }, client_reference_id: OTHER }),
    paid("cs_ref_mismatch", { client_reference_id: OTHER }),
    paid("cs_unpaid", { payment_status: "unpaid" }),
    paid("cs_open", { status: "open" }),
    paid("cs_sub", { mode: "subscription" }),
    paid("cs_wrong_amount", { amount_total: 800 }),
    paid("cs_not_a_pack", { metadata: { user_id: USER } }),
    paid("cs_good"),
  ]);
  const result = await syncSparkPacks({ stripe, admin, userId: USER });
  assert.deepEqual(result, { credited: 1, alreadyCredited: 0 });
  assert.deepEqual(admin.calls.map((c) => c[1].p_reference), ["cs_good"]);
});

test("repair: a database error is reported, never swallowed; a bad user id is refused", async () => {
  const admin = { rpc: async () => ({ error: { message: "boom" } }) };
  await assert.rejects(syncSparkPacks({ stripe: stripeWithSessions([paid("cs_1")]), admin, userId: USER }), /Spark pack credit failed/);
  await assert.rejects(syncSparkPacks({ stripe: stripeWithSessions([]), admin: packAdmin(), userId: "nope" }), /invalid user id/);
});

/* ---------- migration 042 on a real (in-memory) Postgres ---------- */
async function database() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;
    create table public.profiles (
      id uuid primary key, tier text not null default 'free', sparks integer not null default 60,
      sparks_reset_at timestamptz not null default now() + interval '30 days',
      stripe_customer_id text, stripe_subscription_id text
    );
    create function public.tier_allowance(t text) returns integer language sql immutable
      as $$ select case t when 'pro' then 500 else 60 end $$;
    insert into public.profiles (id) values ('${USER}');
  `);
  for (const f of ["012_sparks_ledger.sql", "025_paid_sparks_invoice_only.sql", "041_yearly_plan.sql", "042_spark_packs.sql"])
    await db.exec(await readFile(new URL(`../supabase/migrations/${f}`, import.meta.url), "utf8"));
  return db;
}
const profile = async (db) => (await db.query("select * from public.profiles where id = $1", [USER])).rows[0];
const buy = (db, sparks = 250, ref = "cs_1") => db.query("select public.add_pack_sparks($1, $2, $3) as ok", [USER, sparks, ref]);
const spend = (db, n) => db.query("update public.profiles set sparks = greatest(0, sparks - $1) where id = $2", [n, USER]);

test("SQL: a pack adds its Sparks to the balance and to the protected bought portion, with a ledger row", async () => {
  const db = await database();
  try {
    await buy(db);
    const p = await profile(db);
    assert.deepEqual([p.sparks, p.pack_sparks], [310, 250]);
    const l = await db.query("select delta, balance_after, reference from public.spark_transactions where reason = 'pack_purchase'");
    assert.deepEqual(l.rows.map((r) => [r.delta, r.balance_after, r.reference]), [[250, 310, "cs_1"]]);
  } finally { await db.close(); }
});

test("SQL: the same purchase twice is refused and changes nothing", async () => {
  const db = await database();
  try {
    await buy(db);
    await assert.rejects(buy(db), /duplicate|unique/i);
    assert.deepEqual([(await profile(db)).sparks, (await profile(db)).pack_sparks], [310, 250]);
    await buy(db, 100, "cs_2"); // a different purchase is fine
    assert.deepEqual([(await profile(db)).sparks, (await profile(db)).pack_sparks], [410, 350]);
  } finally { await db.close(); }
});

test("SQL: spending takes the monthly Sparks first, and bought Sparks only once those are gone", async () => {
  const db = await database();
  try {
    await buy(db); // 60 monthly + 250 bought
    await spend(db, 40);
    assert.deepEqual([(await profile(db)).sparks, (await profile(db)).pack_sparks], [270, 250]); // monthly 20 left, bought intact
    await spend(db, 40);
    assert.deepEqual([(await profile(db)).sparks, (await profile(db)).pack_sparks], [230, 230]); // monthly gone, 20 taken from bought
    await spend(db, 500);
    assert.deepEqual([(await profile(db)).sparks, (await profile(db)).pack_sparks], [0, 0]);
  } finally { await db.close(); }
});

test("SQL: the Free monthly reset gives the allowance PLUS the bought Sparks, never wiping them", async () => {
  const db = await database();
  try {
    await buy(db);
    await spend(db, 30); // 30 monthly + 250 bought
    await db.query("update public.profiles set sparks_reset_at = now() - interval '1 hour'");
    const p = (await db.query("select * from public.admin_get_profile($1)", [USER])).rows[0];
    assert.deepEqual([p.sparks, p.pack_sparks], [310, 250]); // 60 fresh monthly + 250 bought
    await db.query("select set_config('app.user_id', $1, false)", [USER]);
    await db.query("update public.profiles set sparks_reset_at = now() - interval '1 hour'");
    const q = (await db.query("select * from public.get_profile()")).rows[0];
    assert.deepEqual([q.sparks, q.pack_sparks], [310, 250]);
  } finally { await db.close(); }
});

test("SQL: a paid Pro invoice grants 500 PLUS the bought Sparks, with an honest ledger entry", async () => {
  const db = await database();
  try {
    await buy(db);
    await db.query("select public.grant_tier_sparks($1, null, 'pro', 500, now() + interval '30 days', 'in_1', 'invoice_grant', 'cus_1', 'sub_1', true)", [USER]);
    const p = await profile(db);
    assert.deepEqual([p.tier, p.sparks, p.pack_sparks], ["pro", 750, 250]);
    const l = await db.query("select delta, balance_after from public.spark_transactions where reference = 'in_1'");
    assert.deepEqual(l.rows.map((r) => [r.delta, r.balance_after]), [[440, 750]]);
    // and a person with no packs gets exactly 500 as before
    await db.query("insert into public.profiles (id) values ($1)", [OTHER]);
    await db.query("select public.grant_tier_sparks($1, null, 'pro', 500, now() + interval '30 days', 'in_2', 'invoice_grant', null, 'sub_2', true)", [OTHER]);
    assert.equal((await db.query("select sparks from public.profiles where id = $1", [OTHER])).rows[0].sparks, 500);
  } finally { await db.close(); }
});

test("SQL: a yearly subscriber's monthly top-up also keeps the bought Sparks", async () => {
  const db = await database();
  try {
    await db.query("update public.profiles set tier = 'pro', billing_interval = 'year', stripe_subscription_id = 'sub_y', sparks = 50, sparks_reset_at = now() - interval '1 hour'");
    await buy(db); // 300 total, 250 bought
    await db.query("update public.profiles set sparks_reset_at = now() - interval '1 hour'");
    const r = await db.query("select public.refill_yearly_sparks($1, 'sub_y', 'yr_1', 500, now() + interval '30 days') as ok", [USER]);
    assert.equal(r.rows[0].ok, true);
    const p = await profile(db);
    assert.deepEqual([p.sparks, p.pack_sparks], [750, 250]);
  } finally { await db.close(); }
});

test("SQL: the invariant 0 <= bought <= balance holds through a mixed sequence", async () => {
  const db = await database();
  try {
    const check = async () => { const p = await profile(db); assert.ok(p.pack_sparks >= 0 && p.pack_sparks <= p.sparks, JSON.stringify(p)); };
    await buy(db, 100, "a"); await check();
    await spend(db, 70); await check();
    await buy(db, 500, "b"); await check();
    await spend(db, 400); await check();
    await db.query("update public.profiles set sparks_reset_at = now() - interval '1 hour'");
    await db.query("select * from public.admin_get_profile($1)", [USER]); await check();
    await spend(db, 10_000); await check();
  } finally { await db.close(); }
});

test("SQL: bad input is refused and only the server (service role) may call add_pack_sparks", async () => {
  const db = await database();
  try {
    await assert.rejects(buy(db, 0, "x"), /invalid Spark pack/);
    await assert.rejects(buy(db, 5001, "x"), /invalid Spark pack/);
    await assert.rejects(buy(db, 100, " "), /invalid Spark pack/);
    await assert.rejects(db.query("select public.add_pack_sparks(null, 100, 'x')"), /invalid Spark pack/);
    await assert.rejects(db.query("select public.add_pack_sparks($1, 100, 'x')", [OTHER]), /profile not found/);
    const priv = async (role) => (await db.query(`select has_function_privilege('${role}', 'public.add_pack_sparks(uuid,integer,text)', 'execute') as ok`)).rows[0].ok;
    assert.deepEqual([await priv("anon"), await priv("authenticated"), await priv("service_role")], [false, false, true]);
    assert.equal((await profile(db)).sparks, 60);
  } finally { await db.close(); }
});
