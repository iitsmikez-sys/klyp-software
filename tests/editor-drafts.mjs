import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const clip = "33333333-3333-4333-8333-333333333333";

test("owned drafts save across sessions and stale revisions cannot overwrite newer edits", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth;
      create function auth.uid() returns uuid language sql stable
        as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;
      create table public.clips (id uuid primary key, user_id uuid not null);
      insert into public.clips values ('${clip}', '${owner}');`);
    await db.exec(await readFile(new URL("../supabase/migrations/018_editor_drafts.sql", import.meta.url), "utf8"));
    await db.exec(`select set_config('app.user_id','${owner}',false)`);
    const first = await db.query("select public.save_clip_editor_draft($1,$2,$3::jsonb) as revision",
      [clip, 0, JSON.stringify({ version: 1, hook: "first" })]);
    assert.equal(first.rows[0].revision, 1);
    const second = await db.query("select public.save_clip_editor_draft($1,$2,$3::jsonb) as revision",
      [clip, 1, JSON.stringify({ version: 1, hook: "second" })]);
    assert.equal(second.rows[0].revision, 2);
    await assert.rejects(db.query("select public.save_clip_editor_draft($1,$2,$3::jsonb)",
      [clip, 1, JSON.stringify({ version: 1, hook: "stale" })]), /draft conflict/);
    assert.equal((await db.query("select draft->>'hook' as hook from public.clip_editor_drafts where clip_id=$1", [clip])).rows[0].hook, "second");
    await db.exec(`select set_config('app.user_id','${other}',false)`);
    await assert.rejects(db.query("select public.save_clip_editor_draft($1,$2,$3::jsonb)",
      [clip, 2, JSON.stringify({ version: 1, hook: "stolen" })]), /clip not found/);
  } finally { await db.close(); }
});

test("draft storage rejects oversized or malformed documents", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth;
      create function auth.uid() returns uuid language sql stable
        as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;
      create table public.clips (id uuid primary key, user_id uuid not null);
      insert into public.clips values ('${clip}', '${owner}');`);
    await db.exec(await readFile(new URL("../supabase/migrations/018_editor_drafts.sql", import.meta.url), "utf8"));
    await db.exec(`select set_config('app.user_id','${owner}',false)`);
    await assert.rejects(db.query("select public.save_clip_editor_draft($1,$2,$3::jsonb)",
      [clip, 0, JSON.stringify({ version: 1, text: "x".repeat(70000) })]), /draft too large/);
    await assert.rejects(db.query("select public.save_clip_editor_draft($1,$2,$3::jsonb)",
      [clip, 0, JSON.stringify([1, 2, 3])]), /invalid draft/);
  } finally { await db.close(); }
});
