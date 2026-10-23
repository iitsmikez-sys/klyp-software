import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const userId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const source = "twitch:2901248464";

async function database(savedClip = false) {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;
    create table public.profiles (
      id uuid primary key, tier text not null default 'free',
      sparks integer not null default 150,
      sparks_reset_at timestamptz not null default now() + interval '30 days',
      stripe_customer_id text, stripe_subscription_id text
    );
    create function public.tier_allowance(t text) returns integer language sql immutable
      as $$ select case t when 'pro' then 500 else 150 end $$;
    create table public.clips (
      id uuid primary key default gen_random_uuid(), user_id uuid not null,
      url text not null, start_seconds double precision not null,
      end_seconds double precision not null, created_at timestamptz not null default now()
    );
    insert into public.profiles (id, sparks) values ('${userId}', 200), ('${otherId}', 200);
    set app.user_id = '${userId}';
  `);
  if (savedClip) {
    await db.query("insert into public.clips (user_id, url, start_seconds, end_seconds) values ($1, $2, 100, 130)",
      [userId, "https://www.twitch.tv/videos/2901248464?filter=all"]);
  }
  await db.exec(await readFile(new URL("../supabase/migrations/012_sparks_ledger.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../supabase/migrations/014_analysis_clip_history.sql", import.meta.url), "utf8"));
  return db;
}

async function run(db, clips, key = source, duration = 3600) {
  const result = await db.query(
    "select * from public.record_analysis_clips($1, $2::jsonb, $3, 3)",
    [key, JSON.stringify(clips), duration]
  );
  return result.rows[0];
}

const clip = (start) => ({ start_seconds: start, end_seconds: start + 30 });

test("repeat returns only new windows and does not charge for exhausted results", async () => {
  const db = await database();
  try {
    assert.deepEqual(await run(db, [clip(100), clip(200), clip(300)]), {
      accepted_indices: [0, 1, 2], sparks_spent: 45, sparks_balance: 155,
    });
    assert.deepEqual(await run(db, [clip(105), clip(220), clip(300)]), {
      accepted_indices: [], sparks_spent: 0, sparks_balance: 155,
    });
    assert.deepEqual(await run(db, [clip(100), clip(400), clip(500)]), {
      accepted_indices: [1, 2], sparks_spent: 42, sparks_balance: 113,
    });
    const ledger = await db.query("select delta from public.spark_transactions where reason = 'analysis' order by created_at");
    assert.deepEqual(ledger.rows.map((row) => row.delta), [-45, -42]);
  } finally { await db.close(); }
});

test("concurrent repeat requests charge once and reserve each moment once", async () => {
  const db = await database();
  try {
    const results = await Promise.all([run(db, [clip(100)]), run(db, [clip(100)])]);
    assert.deepEqual(results.map((row) => row.sparks_spent).sort((a, b) => a - b), [0, 38]);
    const count = await db.query("select count(*)::int as n from public.analysis_clip_history");
    assert.equal(count.rows[0].n, 1);
  } finally { await db.close(); }
});

test("insufficient balance rolls back clip history and charge", async () => {
  const db = await database();
  try {
    await db.query("update public.profiles set sparks = 5 where id = $1", [userId]);
    await assert.rejects(run(db, [clip(100)]), /insufficient sparks/);
    const count = await db.query("select count(*)::int as n from public.analysis_clip_history");
    assert.equal(count.rows[0].n, 0);
    const ledger = await db.query("select count(*)::int as n from public.spark_transactions where reason = 'analysis'");
    assert.equal(ledger.rows[0].n, 0);
  } finally { await db.close(); }
});

test("history is scoped by account and source; first empty run pays only base", async () => {
  const db = await database();
  try {
    assert.equal((await run(db, [])).sparks_spent, 35);
    assert.equal((await run(db, [clip(100)])).sparks_spent, 38);
    await db.exec(`set app.user_id = '${otherId}'`);
    assert.deepEqual((await run(db, [clip(100)])).accepted_indices, [0]);
    assert.deepEqual((await run(db, [clip(100)], "twitch:999")).accepted_indices, [0]);
  } finally { await db.close(); }
});

test("migration backfills saved clips from earlier releases", async () => {
  const db = await database(true);
  try {
    assert.deepEqual(await run(db, [clip(100), clip(200)]), {
      accepted_indices: [1], sparks_spent: 38, sparks_balance: 162,
    });
  } finally { await db.close(); }
});
