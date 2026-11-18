import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  RUN_PROVIDER_LIMIT_MICRO_USD, maxFullPassSeconds, reservedMicroUsdForPass, reviewProcessingBudget, runLimitForSeconds,
} from "../lib/vod-budget.ts";
import { EXTENDED_RUN_LIMIT_MICRO_USD, ProviderBudget } from "../lib/provider-budget-core.ts";
import { estimateSparks, LONG_VIDEO_FROM_SECONDS } from "../lib/sparks.ts";
import { PLAN_LIMITS } from "../lib/plan-limits.ts";

const H = 3600;
const read = (name) => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");

/* ── the code side: who gets which budget ── */
test("everything up to 6 hours keeps the standard $3 budget", () => {
  for (const h of [1, 2, 4, 6]) assert.equal(runLimitForSeconds(h * H), RUN_PROVIDER_LIMIT_MICRO_USD, `${h}h`);
});

test("a 7- or 8-hour video gets the extended $4.50 budget, and its reservation fits inside it", () => {
  for (const h of [7, 8]) {
    assert.equal(runLimitForSeconds(h * H), EXTENDED_RUN_LIMIT_MICRO_USD, `${h}h`);
    assert.ok(reservedMicroUsdForPass(h * H) <= EXTENDED_RUN_LIMIT_MICRO_USD);
    assert.ok(reservedMicroUsdForPass(h * H) > RUN_PROVIDER_LIMIT_MICRO_USD);
  }
});

test("the Pro plan limit (8h + slack) fits the extended budget, so Pro's advertised length works", () => {
  const proSeconds = PLAN_LIMITS.pro.youtube + 30;
  assert.ok(PLAN_LIMITS.pro.youtube <= maxFullPassSeconds(EXTENDED_RUN_LIMIT_MICRO_USD));
  assert.equal(runLimitForSeconds(proSeconds), EXTENDED_RUN_LIMIT_MICRO_USD);
});

test("the extended budget is still a ceiling: a video that cannot fit even $4.50 is refused", () => {
  assert.equal(runLimitForSeconds(10.5 * H), null);
  const r = reviewProcessingBudget([{ start: 0, end: 10.5 * H }], 100, { extendedBudget: true });
  assert.equal(r.exceedsRunLimit, true);
  assert.ok(r.maxRunHours > 8 && r.maxRunHours <= 10);
});

test("only a full pass can use the extended budget; sampled windows keep the standard one", () => {
  const windows = [{ start: 0, end: 8 * H }];
  assert.equal(reviewProcessingBudget(windows, 100).exceedsRunLimit, true);
  assert.equal(reviewProcessingBudget(windows, 100, { extendedBudget: true }).exceedsRunLimit, false);
});

test("the per-run cap is enforced cumulatively at the run's own limit", async () => {
  let reserved = 0;
  const limit = EXTENDED_RUN_LIMIT_MICRO_USD;
  const budget = new ProviderBudget(async (_s, micro) => {
    if (reserved + micro > limit) throw new Error("provider budget exceeded");
    reserved += micro;
  });
  await budget.call("transcribe", 2_700_000, async () => {});
  await budget.call("select", 1_700_000, async () => {});
  await assert.rejects(budget.call("visual-check", 200_000, async () => {}), /exceeded/);
  await assert.rejects(budget.call("select", 4_500_001, async () => {}), /cannot be bounded/);
});

/* ── Sparks ── */
test("Sparks are a smooth line: 10 plus 1 per 5 minutes, rounded up to the next 5, with no cliffs", () => {
  assert.deepEqual([900, 1800, 3600, 5400, 7200, 3 * H, 4 * H, 6 * H, 8 * H].map(estimateSparks), [15, 20, 25, 30, 35, 50, 60, 85, 110]);
  assert.equal(estimateSparks(7 * H), 95);
  assert.equal(estimateSparks(24 * H), 300);
  assert.equal(estimateSparks(60), 15, "the shortest video is the minimum charge");
  assert.equal(estimateSparks(0), 15);
  // no jump anywhere: a minute more video never costs more than 5 Sparks more, and never less
  let previous = estimateSparks(1);
  for (let seconds = 60; seconds <= 10 * H; seconds += 60) {
    const price = estimateSparks(seconds);
    assert.ok(price >= previous && price - previous <= 5, `${seconds}s: ${previous} -> ${price}`);
    previous = price;
  }
  assert.equal(LONG_VIDEO_FROM_SECONDS, 6 * H, "the run budget still uses the 6 hour mark");
});

/* ── the database side (migrations 036 + 038) ── */
const runId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
async function budgetDb() {
  const db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role;");
  await db.exec(await read("036_analysis_provider_budget.sql"));
  await db.exec(await read("038_long_video_budget_and_sparks.sql"));
  return db;
}
const reserve = (db, amount, limit = null, id = runId) =>
  db.query("select public.reserve_analysis_provider_budget($1,$2,$3,$4) as total", [id, "select", amount, limit]);

test("SQL: a run without a limit is capped at $3 exactly as before", async () => {
  const db = await budgetDb();
  try {
    await reserve(db, 2_000_000);
    await assert.rejects(reserve(db, 1_000_001), /budget exceeded: \$3\.00/);
    await reserve(db, 1_000_000);
    await assert.rejects(reserve(db, 1), /budget exceeded/);
  } finally { await db.close(); }
});

test("SQL: the three-argument call used by deployed code still works", async () => {
  const db = await budgetDb();
  try {
    const r = await db.query("select public.reserve_analysis_provider_budget($1,$2,$3) as total", [runId, "transcribe", 500_000]);
    assert.equal(Number(r.rows[0].total), 500_000);
  } finally { await db.close(); }
});

test("SQL: an extended run may reserve up to $4.50, no more", async () => {
  const db = await budgetDb();
  try {
    await reserve(db, 2_700_000, 4_500_000);
    await reserve(db, 1_800_000);
    await assert.rejects(reserve(db, 1), /budget exceeded: \$4\.50/);
    const row = await db.query("select reserved_micro_usd, limit_micro_usd from public.analysis_provider_budgets");
    assert.deepEqual([Number(row.rows[0].reserved_micro_usd), Number(row.rows[0].limit_micro_usd)], [4_500_000, 4_500_000]);
  } finally { await db.close(); }
});

test("SQL: the limit is fixed by the first reservation and cannot be raised later", async () => {
  const db = await budgetDb();
  try {
    await reserve(db, 1_000_000); // standard run
    await assert.rejects(reserve(db, 3_000_000, 4_500_000), /budget exceeded: \$3\.00/);
  } finally { await db.close(); }
});

test("SQL: limits outside $3 to $4.50 and single calls above $4.50 are refused", async () => {
  const db = await budgetDb();
  try {
    for (const [amount, limit] of [[1, 4_500_001], [1, 2_999_999], [4_500_001, 4_500_000], [0, null]])
      await assert.rejects(reserve(db, amount, limit), /cannot be bounded/);
    const rows = await db.query("select count(*)::int as count from public.analysis_provider_budgets");
    assert.equal(rows.rows[0].count, 0);
  } finally { await db.close(); }
});

const userId = "11111111-1111-4111-8111-111111111111";
async function sparksDb() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;
    create table public.profiles (
      id uuid primary key, tier text not null default 'free', sparks integer not null default 150,
      sparks_reset_at timestamptz not null default now() + interval '30 days',
      stripe_customer_id text, stripe_subscription_id text
    );
    create function public.tier_allowance(t text) returns integer language sql immutable
      as $$ select case t when 'pro' then 500 else 150 end $$;
    create table public.clips (
      id uuid primary key default gen_random_uuid(), user_id uuid not null, url text not null,
      start_seconds double precision not null, end_seconds double precision not null, created_at timestamptz not null default now()
    );
    insert into public.profiles (id, tier, sparks) values ('${userId}', 'pro', 500);
    set app.user_id = '${userId}';
  `);
  for (const f of ["012_sparks_ledger.sql", "014_analysis_clip_history.sql", "035_clip_discovery_counts.sql"])
    await db.exec(await read(f));
  await db.exec("create table public.analysis_provider_budgets (run_id uuid primary key, reserved_micro_usd bigint not null default 0, updated_at timestamptz not null default now());");
  await db.exec(await read("038_long_video_budget_and_sparks.sql"));
  await db.exec(await read("039_video_only_pricing.sql"));
  // 053 replaces the price. The older 4-argument version must go first, as migration 050 does in production.
  await db.exec("drop function if exists public.record_analysis_clips(text, jsonb, double precision, integer);");
  await db.exec(await read("053_smooth_sparks.sql"));
  return db;
}

test("SQL: the Sparks charge matches estimateSparks for every length, so UI and ledger agree", async () => {
  for (const seconds of [1000, 1500, 1501, 1800, 2400, 3599, 3600, 5400, 7199, 7200, 4 * H, 4 * H + 1, 5 * H, 6 * H, 6 * H + 1, 7 * H, 7 * H + 1, 8 * H, 8 * H + 30, 24 * H]) {
    const db = await sparksDb();
    try {
      const r = await db.query("select * from public.record_analysis_clips($1, $2::jsonb, $3, $4)",
        ["youtube:AAAAAAAAAAA", JSON.stringify([{ start_seconds: 100, end_seconds: 130 }]), seconds, 1]);
      assert.equal(r.rows[0].sparks_spent, estimateSparks(seconds), `${seconds}s`);
    } finally { await db.close(); }
  }
});

test("SQL: the database price equals the app's price on a dense sweep of lengths, not just a few", async () => {
  const db = await sparksDb();
  try {
    const rows = await db.query("select s::double precision as s, (ceil((10 + s::double precision / 300.0) / 5.0) * 5)::integer as cost from generate_series(1, 200000, 7) as s");
    assert.ok(rows.rows.length > 25000);
    for (const row of rows.rows) assert.equal(row.cost, estimateSparks(row.s), `${row.s}s`);
    // and the migration really contains that expression, so this test is about the shipped SQL
    assert.ok((await read("053_smooth_sparks.sql")).includes("v_vod_cost := (ceil((10 + v_billed / 300.0) / 5.0) * 5)::integer;"));
  } finally { await db.close(); }
});

test("SQL: clips are included in the video price, and a run that finds no new clips costs nothing", async () => {
  const clips = (n) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ start_seconds: 100 + i * 200, end_seconds: 130 + i * 200 })));
  const charge = async (db, key, n, seconds, requested = 10) =>
    (await db.query("select * from public.record_analysis_clips($1, $2::jsonb, $3, $4)", [key, clips(n), seconds, requested])).rows[0];
  const db = await sparksDb();
  try {
    assert.equal((await charge(db, "youtube:AAAAAAAAAAA", 10, 3 * H)).sparks_spent, 50); // ten clips, one price
    assert.equal((await charge(db, "youtube:BBBBBBBBBBB", 1, 3 * H)).sparks_spent, 50); // one clip, same price
    assert.equal((await charge(db, "youtube:CCCCCCCCCCC", 0, 3600)).sparks_spent, 0); // nothing found: free
    assert.equal((await charge(db, "youtube:DDDDDDDDDDD", 0, 20 * 60)).sparks_spent, 0); // nothing found: free
    assert.equal((await charge(db, "youtube:BBBBBBBBBBB", 0, 3 * H)).sparks_spent, 0); // clips already delivered, nothing new: free
    assert.equal((await charge(db, "youtube:EEEEEEEEEEE", 3, 3600, 3)).sparks_spent, 25); // older requests priced the same
  } finally { await db.close(); }
});
