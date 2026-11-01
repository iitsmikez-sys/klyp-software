import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const runId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const migration = await readFile(new URL('../supabase/migrations/036_analysis_provider_budget.sql', import.meta.url), 'utf8');

async function database() {
  const db = new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role;');
  await db.exec(migration);
  return db;
}

test('durable provider reservations never exceed $3 across concurrent calls', async () => {
  const db = await database();
  try {
    const reserve = (amount) => db.query('select public.reserve_analysis_provider_budget($1,$2,$3) as total', [runId, 'select', amount]);
    const results = await Promise.allSettled([reserve(2_000_000), reserve(2_000_000)]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
    const row = await db.query('select reserved_micro_usd from public.analysis_provider_budgets where run_id=$1', [runId]);
    assert.equal(Number(row.rows[0].reserved_micro_usd), 2_000_000);
    await assert.rejects(reserve(1_000_001), /budget exceeded/);
    await reserve(1_000_000);
    await assert.rejects(reserve(1), /budget exceeded/);
  } finally { await db.close(); }
});

test('unknown stages and unbounded amounts cannot reserve', async () => {
  const db = await database();
  try {
    for (const [stage, amount] of [['select', 0], ['select', 3_000_001], ['unknown', 1]]) {
      await assert.rejects(db.query('select public.reserve_analysis_provider_budget($1,$2,$3)', [runId, stage, amount]), /cannot be bounded/);
    }
    const rows = await db.query('select count(*)::int as count from public.analysis_provider_budgets');
    assert.equal(rows.rows[0].count, 0);
  } finally { await db.close(); }
});
