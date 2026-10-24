import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const clip = "33333333-3333-4333-8333-333333333333";

test("creator feedback is idempotent and only the clip owner can record it", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth;
      create function auth.uid() returns uuid language sql stable
        as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;
      create table public.clips (id uuid primary key, user_id uuid not null, clip_type text not null);
      create table public.clip_editor_drafts (clip_id uuid primary key, user_id uuid not null,
        draft jsonb not null, revision int not null);
      insert into public.clips values ('${clip}', '${owner}', 'FUNNY');`);
    await db.exec(await readFile(new URL("../supabase/migrations/019_clip_feedback.sql", import.meta.url), "utf8"));
    await db.exec(`select set_config('app.user_id','${owner}',false)`);
    await db.query("select public.record_clip_feedback($1,$2)", [clip, "approved"]);
    await db.query("select public.record_clip_feedback($1,$2)", [clip, "downloaded"]);
    await db.query("select public.record_clip_feedback($1,$2)", [clip, "downloaded"]);
    const row = (await db.query("select verdict, downloaded_at is not null as downloaded from public.clip_feedback")).rows[0];
    assert.equal(row.verdict, "approved");
    assert.equal(row.downloaded, true);
    assert.equal((await db.query("select count(*)::int as n from public.clip_feedback")).rows[0].n, 1);
    await db.query("select public.record_clip_feedback($1,$2)", [clip, "rejected"]);
    assert.equal((await db.query("select verdict from public.clip_feedback")).rows[0].verdict, "rejected");
    await assert.rejects(db.query("select public.record_clip_feedback($1,$2)", [clip, "invented"]), /invalid feedback/);
    await db.exec(`select set_config('app.user_id','${other}',false)`);
    await assert.rejects(db.query("select public.record_clip_feedback($1,$2)", [clip, "approved"]), /clip not found/);
  } finally { await db.close(); }
});

test("saving a later editor revision records an edit signal", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth;
      create function auth.uid() returns uuid language sql stable
        as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;
      create table public.clips (id uuid primary key, user_id uuid not null, clip_type text not null);
      create table public.clip_editor_drafts (clip_id uuid primary key, user_id uuid not null,
        draft jsonb not null, revision int not null);
      insert into public.clips values ('${clip}', '${owner}', 'FUNNY');`);
    await db.exec(await readFile(new URL("../supabase/migrations/019_clip_feedback.sql", import.meta.url), "utf8"));
    await db.query("insert into public.clip_editor_drafts values ($1,$2,$3::jsonb,$4)",
      [clip, owner, JSON.stringify({ version: 1 }), 1]);
    assert.equal((await db.query("select count(*)::int as n from public.clip_feedback")).rows[0].n, 0);
    await db.query("update public.clip_editor_drafts set revision=2 where clip_id=$1", [clip]);
    assert.equal((await db.query("select edited_at is not null as edited from public.clip_feedback")).rows[0].edited, true);
  } finally { await db.close(); }
});
