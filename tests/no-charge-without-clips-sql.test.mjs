import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const userId = "11111111-1111-4111-8111-111111111111";

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
    create table public.clips (
      id uuid primary key default gen_random_uuid(), user_id uuid not null, url text not null,
      start_seconds double precision not null, end_seconds double precision not null, created_at timestamptz not null default now()
    );
    insert into public.profiles (id, sparks) values ('${userId}', 60);
    set app.user_id = '${userId}';
  `);
  for (const file of ["012_sparks_ledger", "014_analysis_clip_history", "043_no_charge_without_clips"]) {
    await db.exec(await readFile(new URL(`../supabase/migrations/${file}.sql`, import.meta.url), "utf8"));
  }
  return db;
}

const run = async (db, clips, key, duration) =>
  (await db.query("select * from public.record_analysis_clips($1, $2::jsonb, $3, $4)", [key, JSON.stringify(clips), duration, 10])).rows[0];
const clip = (start) => ({ start_seconds: start, end_seconds: start + 30 });

test("an analysis that finds no clips is free, the first time and on every retry", async () => {
  const db = await database();
  try {
    for (let i = 0; i < 3; i++) {
      assert.deepEqual(await run(db, [], "twitch:2917690402", 20 * 60), { accepted_indices: [], sparks_spent: 0, sparks_balance: 60 });
    }
    const ledger = await db.query("select count(*)::int as n from public.spark_transactions where reason = 'analysis'");
    assert.equal(ledger.rows[0].n, 0, "nothing is written to the ledger");
  } finally { await db.close(); }
});

test("a result with at least one new clip still costs the video price, and an exhausted repeat is free", async () => {
  const db = await database();
  try {
    assert.deepEqual(await run(db, [clip(100)], "twitch:2915437291", 51 * 60), { accepted_indices: [0], sparks_spent: 35, sparks_balance: 25 });
    assert.deepEqual(await run(db, [clip(110)], "twitch:2915437291", 51 * 60), { accepted_indices: [], sparks_spent: 0, sparks_balance: 25 });
    assert.deepEqual(await run(db, [], "twitch:2915437291", 51 * 60), { accepted_indices: [], sparks_spent: 0, sparks_balance: 25 });
  } finally { await db.close(); }
});

test("the migration changes only the price rule: the old half-price line is gone", async () => {
  const sql = await readFile(new URL("../supabase/migrations/043_no_charge_without_clips.sql", import.meta.url), "utf8");
  assert.ok(!sql.includes("ceil(v_vod_cost / 2.0)"));
  assert.ok(sql.includes("v_cost := case when cardinality(v_accepted) > 0 then v_vod_cost else 0 end;"));
});
