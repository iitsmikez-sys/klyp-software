import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const user = "11111111-1111-4111-8111-111111111111";
const stream = "22222222-2222-4222-8222-222222222222";
const video = "2901248464";
const url = `https://www.twitch.tv/videos/${video}`;

async function database() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;
    create table public.profiles (id uuid primary key, sparks integer not null);
    create table public.streams (id uuid primary key, user_id uuid not null,
      auto_clip_enabled boolean not null default true,
      last_seen_video_id text, created_at timestamptz not null default now());
    create table public.clips (id uuid primary key default gen_random_uuid(),
      user_id uuid not null, url text not null, title text not null,
      clip_type text not null, viral_score integer not null,
      caption text, reason text, start_seconds double precision not null,
      end_seconds double precision not null, hooks jsonb, words jsonb,
      dim_hype integer, dim_emotion integer, dim_skill integer,
      dim_comedy integer, dim_storyline integer);
    create table public.spark_transactions (id uuid primary key default gen_random_uuid(),
      user_id uuid not null, delta integer not null, reason text not null,
      reference text, balance_after integer not null);
    insert into public.profiles values ('${user}', 100);
    insert into public.streams (id, user_id) values ('${stream}', '${user}');
  `);
  await db.exec(await readFile(new URL("../supabase/migrations/016_auto_vod_jobs.sql", import.meta.url), "utf8"));
  return db;
}

const clips = [{ title: "A moment", clip_type: "FUNNY", viral_score: 80,
  caption: "A caption", reason: "A reason", start_seconds: 10, end_seconds: 40,
  hooks: ["A HOOK"], words: [], dim_hype: 12 }];

test("one VOD is enqueued once and charged only when clips commit", async () => {
  const db = await database();
  try {
    const first = await db.query("select public.enqueue_auto_vod_job($1,$2,$3,$4) as id",
      [stream, video, url, 3600]);
    const second = await db.query("select public.enqueue_auto_vod_job($1,$2,$3,$4) as id",
      [stream, video, url, 3600]);
    assert.equal(first.rows[0].id, second.rows[0].id);
    const before = await db.query("select sparks from public.profiles where id=$1", [user]);
    assert.equal(before.rows[0].sparks, 100);
    const claimed = await db.query("select * from public.claim_auto_vod_job()");
    assert.equal(claimed.rows.length, 1);
    assert.equal(claimed.rows[0].video_id, video);
    assert.equal((await db.query("select count(*)::int as n from public.claim_auto_vod_job()")).rows[0].n, 0);
    const completed = await db.query("select public.finish_auto_vod_job($1,$2::jsonb,$3) as saved",
      [first.rows[0].id, JSON.stringify(clips), 40]);
    assert.equal(completed.rows[0].saved, true);
    const repeat = await db.query("select public.finish_auto_vod_job($1,$2::jsonb,$3) as saved",
      [first.rows[0].id, JSON.stringify(clips), 40]);
    assert.equal(repeat.rows[0].saved, false);
    assert.equal((await db.query("select sparks from public.profiles where id=$1", [user])).rows[0].sparks, 60);
    assert.equal((await db.query("select count(*)::int as n from public.clips")).rows[0].n, 1);
    assert.equal((await db.query("select count(*)::int as n from public.spark_transactions")).rows[0].n, 1);
    assert.equal((await db.query("select last_seen_video_id from public.streams where id=$1", [stream])).rows[0].last_seen_video_id, video);
  } finally { await db.close(); }
});

test("failed processing remains retryable and never advances the stream cursor", async () => {
  const db = await database();
  try {
    const created = await db.query("select public.enqueue_auto_vod_job($1,$2,$3,$4) as id",
      [stream, video, url, 3600]);
    const id = created.rows[0].id;
    await db.query("select * from public.claim_auto_vod_job()");
    await db.query("select public.fail_auto_vod_job($1,$2,$3)", [id, "transcription failed", 0]);
    assert.equal((await db.query("select last_seen_video_id from public.streams where id=$1", [stream])).rows[0].last_seen_video_id, null);
    const retry = await db.query("select * from public.claim_auto_vod_job()");
    assert.equal(retry.rows.length, 1);
    assert.equal(retry.rows[0].attempts, 2);
    assert.equal((await db.query("select sparks from public.profiles where id=$1", [user])).rows[0].sparks, 100);
  } finally { await db.close(); }
});

test("failed transaction leaves the VOD uncharged, unsaved, and retryable", async () => {
  const db = await database();
  try {
    const created = await db.query("select public.enqueue_auto_vod_job($1,$2,$3,$4) as id",
      [stream, video, url, 3600]);
    const id = created.rows[0].id;
    await db.query("select * from public.claim_auto_vod_job()");
    await assert.rejects(db.query("select public.finish_auto_vod_job($1,$2::jsonb,$3)",
      [id, JSON.stringify(clips), 101]), /insufficient sparks/);
    assert.equal((await db.query("select count(*)::int as n from public.clips")).rows[0].n, 0);
    assert.equal((await db.query("select count(*)::int as n from public.spark_transactions")).rows[0].n, 0);
    assert.equal((await db.query("select last_seen_video_id from public.streams where id=$1", [stream])).rows[0].last_seen_video_id, null);
  } finally { await db.close(); }
});

test("disabling auto-clipping before completion cancels the job without a charge", async () => {
  const db = await database();
  try {
    const created = await db.query("select public.enqueue_auto_vod_job($1,$2,$3,$4) as id",
      [stream, video, url, 3600]);
    const id = created.rows[0].id;
    await db.query("select * from public.claim_auto_vod_job()");
    await db.query("update public.streams set auto_clip_enabled=false where id=$1", [stream]);
    const result = await db.query("select public.finish_auto_vod_job($1,$2::jsonb,$3) as saved",
      [id, JSON.stringify(clips), 40]);
    assert.equal(result.rows[0].saved, false);
    assert.equal((await db.query("select status from public.auto_vod_jobs where id=$1", [id])).rows[0].status, "canceled");
    assert.equal((await db.query("select count(*)::int as n from public.clips")).rows[0].n, 0);
    assert.equal((await db.query("select sparks from public.profiles where id=$1", [user])).rows[0].sparks, 100);
  } finally { await db.close(); }
});

test("disabled channels cannot enqueue a new automatic VOD", async () => {
  const db = await database();
  try {
    await db.query("update public.streams set auto_clip_enabled=false where id=$1", [stream]);
    await assert.rejects(db.query("select public.enqueue_auto_vod_job($1,$2,$3,$4)",
      [stream, video, url, 3600]), /auto-clipping disabled/);
    assert.equal((await db.query("select count(*)::int as n from public.auto_vod_jobs")).rows[0].n, 0);
  } finally { await db.close(); }
});
