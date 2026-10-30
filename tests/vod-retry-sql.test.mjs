import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('experimental auto job stops after two attempts instead of paying for five retries', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
      create table public.auto_vod_jobs(id uuid primary key, attempts integer, status text,
        lease_until timestamptz, retry_at timestamptz, last_error text, updated_at timestamptz);`);
    await db.exec(await readFile(new URL('../supabase/migrations/024_vod_analysis_cache.sql', import.meta.url), 'utf8'));
    const id='11111111-1111-4111-8111-111111111111';
    await db.query(`insert into public.auto_vod_jobs(id,attempts,status) values ($1,2,'processing')`, [id]);
    const result=await db.query(`select public.fail_auto_vod_job_limited($1,'temporary failure',120,2) as status`, [id]);
    assert.equal(result.rows[0].status, 'failed');
  } finally { await db.close(); }
});
