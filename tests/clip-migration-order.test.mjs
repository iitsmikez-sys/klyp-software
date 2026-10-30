import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const migration = name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');

test('fresh database can apply clip editor migration before clips table creation', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    `);
    await db.exec(await migration('003_clip_editor.sql'));
    await db.exec(await migration('004_clips_rls.sql'));
    const columns = await db.query(`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'clips'
        and column_name in ('hooks', 'words')
      order by column_name
    `);
    assert.deepEqual(columns.rows.map(row => row.column_name), ['hooks', 'words']);
  } finally {
    await db.close();
  }
});

test('clip editor migration still adds missing columns to an existing clips table', async () => {
  const db = new PGlite();
  try {
    await db.exec('create table public.clips (id uuid primary key)');
    await db.exec(await migration('003_clip_editor.sql'));
    const columns = await db.query(`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'clips'
        and column_name in ('hooks', 'words')
      order by column_name
    `);
    assert.deepEqual(columns.rows.map(row => row.column_name), ['hooks', 'words']);
  } finally {
    await db.close();
  }
});
