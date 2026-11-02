import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('migration 037 adds nullable columns without touching existing jobs, and can be re-run', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create table public.analysis_jobs (id uuid primary key, user_id uuid not null, status text not null default 'queued',
        created_at timestamptz not null default now());
      insert into public.analysis_jobs (id, user_id) values ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222');
    `);
    const sql = await readFile(new URL('../supabase/migrations/037_free_capacity.sql', import.meta.url), 'utf8');
    await db.exec(sql);
    await db.exec(sql); // idempotent
    const row = (await db.query('select plan_at_start, est_cost_micro_usd, status from public.analysis_jobs')).rows[0];
    assert.deepEqual(row, { plan_at_start: null, est_cost_micro_usd: null, status: 'queued' });
    await db.query("update public.analysis_jobs set plan_at_start = 'free', est_cost_micro_usd = 2000000");
    await assert.rejects(db.query("update public.analysis_jobs set plan_at_start = 'platinum'"));
    await assert.rejects(db.query('update public.analysis_jobs set est_cost_micro_usd = -1'));
    const sum = await db.query("select sum(est_cost_micro_usd)::int as s from public.analysis_jobs where plan_at_start = 'free' and created_at >= date_trunc('day', now())");
    assert.equal(sum.rows[0].s, 2000000);
  } finally { await db.close(); }
});
