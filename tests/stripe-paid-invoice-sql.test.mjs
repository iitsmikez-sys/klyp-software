import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const userId = "11111111-1111-4111-8111-111111111111";

async function database() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;
    create table public.profiles (
      id uuid primary key,
      tier text not null default 'free',
      sparks integer not null default 150,
      sparks_reset_at timestamptz not null default now() + interval '30 days',
      stripe_customer_id text,
      stripe_subscription_id text
    );
    create function public.tier_allowance(t text) returns integer language sql immutable
      as $$ select case t when 'pro' then 500 else 150 end $$;
    insert into public.profiles (id, sparks) values ('${userId}', 100);
  `);
  await db.exec(await readFile(new URL("../supabase/migrations/012_sparks_ledger.sql", import.meta.url), "utf8"));
  if (process.env.TEST_STRIPE_SQL_BASELINE !== "1") {
    await db.exec(await readFile(new URL("../supabase/migrations/013_paid_invoice_sparks.sql", import.meta.url), "utf8"));
  }
  return db;
}

async function grant(db, invoiceId, periodStart = 1760000000, subscriptionId = "sub_1", paidAt = periodStart + 10) {
  return db.query(`select public.grant_paid_invoice_sparks(
    $1::uuid, null, $2, to_timestamp($3), to_timestamp($3 + 2592000),
    'cus_1', $4, to_timestamp($5)
  )`, [userId, invoiceId, periodStart, subscriptionId, paidAt]);
}

async function downgrade(db, subscriptionId, eventCreated) {
  return db.query(`select public.downgrade_subscription_if_current(
    $1::uuid, null, $2, to_timestamp($3)
  )`, [userId, subscriptionId, eventCreated]);
}

test("repeated grant calls for one paid invoice leave the balance and ledger unchanged", async () => {
  const db = await database();
  try {
    await grant(db, "in_first");
    await db.query("update public.profiles set sparks = 400 where id = $1", [userId]);
    await Promise.all([grant(db, "in_first"), grant(db, "in_first")]);
    const balance = await db.query("select sparks from public.profiles where id = $1", [userId]);
    const ledger = await db.query("select reference from public.spark_transactions where reason = 'invoice_grant'");
    assert.equal(balance.rows[0].sparks, 400);
    assert.deepEqual(ledger.rows.map((row) => row.reference), ["in_first"]);
    await grant(db, "in_next_cycle", 1762592000);
    const next = await db.query("select sparks from public.profiles where id = $1", [userId]);
    assert.equal(next.rows[0].sparks, 500);
  } finally {
    await db.close();
  }
});

test("a late older paid invoice cannot refill after a newer billing cycle", async () => {
  const db = await database();
  try {
    await grant(db, "in_new", 1762592000);
    await db.query("update public.profiles set sparks = 400 where id = $1", [userId]);
    await grant(db, "in_old", 1760000000);
    const profile = await db.query("select sparks from public.profiles where id = $1", [userId]);
    const ledger = await db.query("select reference from public.spark_transactions where reason = 'invoice_grant'");
    assert.equal(profile.rows[0].sparks, 400);
    assert.deepEqual(ledger.rows.map((row) => row.reference), ["in_new"]);
  } finally {
    await db.close();
  }
});

test("a new paid subscription can grant at the same period start as a canceled one", async () => {
  const db = await database();
  try {
    await grant(db, "in_old_sub", 1760000000, "sub_old");
    await db.query("update public.profiles set tier = 'free', stripe_subscription_id = null, sparks = 40 where id = $1", [userId]);
    await grant(db, "in_new_sub", 1760000000, "sub_new");
    const profile = await db.query("select tier, sparks, stripe_subscription_id from public.profiles where id = $1", [userId]);
    assert.deepEqual(profile.rows, [{ tier: "pro", sparks: 500, stripe_subscription_id: "sub_new" }]);
  } finally {
    await db.close();
  }
});

test("an older terminal event cannot undo a newer paid invoice", async () => {
  const db = await database();
  try {
    await grant(db, "in_paid", 1760000000, "sub_1", 1760000020);
    await downgrade(db, "sub_1", 1760000010);
    const profile = await db.query("select tier, stripe_subscription_id from public.profiles where id = $1", [userId]);
    assert.deepEqual(profile.rows, [{ tier: "pro", stripe_subscription_id: "sub_1" }]);
    await downgrade(db, "sub_1", 1760000030);
    const ended = await db.query("select tier, stripe_subscription_id from public.profiles where id = $1", [userId]);
    assert.deepEqual(ended.rows, [{ tier: "free", stripe_subscription_id: null }]);
  } finally {
    await db.close();
  }
});

test("same-second cancellation removes access; a reactivated paid subscription can restore it", async () => {
  const db = await database();
  try {
    await grant(db, "in_paid", 1760000000, "sub_1", 1760000020);
    await downgrade(db, "sub_1", 1760000020);
    let profile = await db.query("select tier from public.profiles where id = $1", [userId]);
    assert.equal(profile.rows[0].tier, "free");
    await db.query("select public.restore_paid_subscription_if_current($1::uuid, null, 'sub_1', to_timestamp(1760000020))", [userId]);
    profile = await db.query("select tier, stripe_subscription_id, sparks from public.profiles where id = $1", [userId]);
    assert.deepEqual(profile.rows, [{ tier: "pro", stripe_subscription_id: "sub_1", sparks: 500 }]);
  } finally {
    await db.close();
  }
});

test("an old payment cannot restore Pro after a later terminal event", async () => {
  const db = await database();
  try {
    await grant(db, "in_paid", 1760000000, "sub_1", 1760000020);
    await downgrade(db, "sub_1", 1760000030);
    await db.query("select public.restore_paid_subscription_if_current($1::uuid, null, 'sub_1', to_timestamp(1760000030))", [userId]);
    const profile = await db.query("select tier, stripe_subscription_id from public.profiles where id = $1", [userId]);
    assert.deepEqual(profile.rows, [{ tier: "free", stripe_subscription_id: null }]);
  } finally {
    await db.close();
  }
});

test("an expired Pro reset date does not refill without a paid invoice", async () => {
  const db = await database();
  try {
    await db.query("update public.profiles set tier = 'pro', sparks = 80, sparks_reset_at = now() - interval '1 day' where id = $1", [userId]);
    await db.query("select set_config('app.user_id', $1, false)", [userId]);
    const profile = await db.query("select (public.get_profile()).sparks as sparks");
    assert.equal(profile.rows[0].sparks, 80);
    const resets = await db.query("select count(*)::int as count from public.spark_transactions where reason = 'monthly_reset'");
    assert.equal(resets.rows[0].count, 0);
  } finally {
    await db.close();
  }
});

test("the admin profile path also waits for a paid Pro invoice", async () => {
  const db = await database();
  try {
    await db.query("update public.profiles set tier = 'pro', sparks = 80, sparks_reset_at = now() - interval '1 day' where id = $1", [userId]);
    const profile = await db.query("select (public.admin_get_profile($1::uuid)).sparks as sparks", [userId]);
    assert.equal(profile.rows[0].sparks, 80);
  } finally {
    await db.close();
  }
});

test("an expired Free reset date still refills and records the transaction", async () => {
  const db = await database();
  try {
    await db.query("update public.profiles set sparks = 20, sparks_reset_at = now() - interval '1 day' where id = $1", [userId]);
    await db.query("select set_config('app.user_id', $1, false)", [userId]);
    const profile = await db.query("select (public.get_profile()).sparks as sparks");
    assert.equal(profile.rows[0].sparks, 150);
    const ledger = await db.query("select delta, balance_after from public.spark_transactions where reason = 'monthly_reset'");
    assert.deepEqual(ledger.rows, [{ delta: 130, balance_after: 150 }]);
  } finally {
    await db.close();
  }
});
