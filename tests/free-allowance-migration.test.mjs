import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("corrects only free accounts opened with 60 Sparks and records the credit once", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create table public.profiles (id integer primary key, tier text not null, sparks integer not null default 60);
      create table public.spark_transactions (
        user_id integer not null, delta integer not null, reason text not null,
        reference text, balance_after integer not null
      );
      insert into public.profiles (id,tier,sparks) values
        (1,'free',40), (2,'free',50), (3,'pro',60), (4,'free',60);
      insert into public.spark_transactions (user_id,delta,reason,balance_after) values
        (1,60,'opening_balance',60), (1,-20,'analysis',40),
        (2,150,'opening_balance',150), (2,-100,'analysis',50),
        (3,60,'opening_balance',60),
        (4,60,'opening_balance',60);
    `);
    const migration = await readFile(new URL("../supabase/migrations/015_free_allowance_ledger.sql", import.meta.url), "utf8");
    await db.exec(migration);
    await db.exec(migration);
    const balances = await db.query("select id, sparks from public.profiles order by id");
    assert.deepEqual(balances.rows, [
      { id: 1, sparks: 130 }, { id: 2, sparks: 50 },
      { id: 3, sparks: 60 }, { id: 4, sparks: 150 },
    ]);
    const credits = await db.query("select user_id, delta, balance_after from public.spark_transactions where reason='allowance_correction' order by user_id");
    assert.deepEqual(credits.rows, [
      { user_id: 1, delta: 90, balance_after: 130 },
      { user_id: 4, delta: 90, balance_after: 150 },
    ]);
    const fresh = await db.query("insert into public.profiles (id,tier) values (5,'free') returning sparks");
    assert.equal(fresh.rows[0].sparks, 150);
  } finally {
    await db.close();
  }
});

