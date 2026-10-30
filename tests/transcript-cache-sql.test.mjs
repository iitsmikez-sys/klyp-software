import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('transcript cache stores exact coverage and rejects invalid intervals', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users(id uuid primary key);
      create table public.auto_vod_jobs(id uuid primary key, status text, attempts integer, lease_until timestamptz, retry_at timestamptz, last_error text, updated_at timestamptz);
      create function auth.uid() returns uuid language sql stable
        as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;`);
    await db.exec(await readFile(new URL('../supabase/migrations/024_vod_analysis_cache.sql', import.meta.url), 'utf8'));
    const user = '11111111-1111-4111-8111-111111111111';
    await db.query('insert into auth.users(id) values ($1)', [user]);
    await db.query(`insert into public.analysis_transcript_cache
      (user_id, source_key, vod_seconds, version, model, start_seconds, end_seconds, actual_audio_seconds, words)
      values ($1,'twitch:123',36000,'v2','best',35400,35520,120,'[]'::jsonb)`, [user]);
    const row = await db.query('select start_seconds,end_seconds from public.analysis_transcript_cache');
    assert.deepEqual(row.rows.map(r => [r.start_seconds, r.end_seconds]), [[35400, 35520]]);
    await db.query(`insert into public.analysis_result_cache
      (user_id, source_key, vod_seconds, request_hash, clips)
      values ($1,'twitch:123',36000,'hash123','[]'::jsonb)`, [user]);
    const results = await db.query('select count(*)::int as n from public.analysis_result_cache');
    assert.equal(results.rows[0].n, 1);
    await assert.rejects(db.query(`insert into public.analysis_transcript_cache
      (user_id, source_key, vod_seconds, version, model, start_seconds, end_seconds, actual_audio_seconds, words)
      values ($1,'twitch:123',36000,'v2','best',35990,36010,20,'[]'::jsonb)`, [user]));
  } finally { await db.close(); }
});
