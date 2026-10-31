import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('YouTube connections are private and a request key can create only one post', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;
      create table public.profiles(id uuid primary key);
      create table public.clips(id uuid primary key, user_id uuid not null);`);
    await db.exec(await readFile(new URL('../supabase/migrations/034_youtube_publishing.sql', import.meta.url), 'utf8'));
    const user = '11111111-1111-4111-8111-111111111111';
    const clip = '22222222-2222-4222-8222-222222222222';
    const key = '33333333-3333-4333-8333-333333333333';
    await db.query('insert into public.profiles values ($1)', [user]);
    await db.query('insert into public.clips values ($1,$2)', [clip, user]);
    await db.query('insert into public.youtube_connections(user_id, refresh_token_enc) values ($1,$2)', [user, 'ciphertext']);
    await db.query(`insert into public.youtube_posts(user_id,clip_id,request_key,title,description,status)
      values ($1,$2,$3,'Clip','','processing')`, [user, clip, key]);
    await assert.rejects(db.query(`insert into public.youtube_posts(user_id,clip_id,request_key,title,description,status)
      values ($1,$2,$3,'Clip','','processing')`, [user, clip, key]), /unique|duplicate/i);
    await assert.rejects(db.query(`insert into public.youtube_posts(user_id,clip_id,request_key,title,description,status)
      values ($1,$2,$3,'Clip','','processing')`, [user, clip, '44444444-4444-4444-8444-444444444444']), /unique|duplicate/i);
    assert.equal((await db.query('select count(*)::int as n from public.youtube_posts')).rows[0].n, 1);
    const grants = await db.query(`select table_name, privilege_type from information_schema.role_table_grants
      where grantee='authenticated' and table_name in ('youtube_connections','youtube_posts')`);
    assert.equal(grants.rows.some(row => row.table_name === 'youtube_connections'), false);
    assert.deepEqual(grants.rows.filter(row => row.table_name === 'youtube_posts').map(row => row.privilege_type), ['SELECT']);
  } finally { await db.close(); }
});
