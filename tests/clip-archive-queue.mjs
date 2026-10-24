import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

async function database() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema storage;
    create table storage.buckets (id text primary key, name text not null,
      public boolean not null, file_size_limit bigint);
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    create table public.clips (id uuid primary key default gen_random_uuid(),
      user_id uuid not null, url text not null, title text not null,
      start_seconds double precision not null, end_seconds double precision not null,
      master_path text, proxy_path text, poster_path text,
      archive_status text not null default 'none', archive_error text,
      archived_at timestamptz, archive_bytes bigint,
      created_at timestamptz not null default now());
    create table public.clip_archive_jobs (clip_id uuid primary key references public.clips(id) on delete cascade,
      status text not null default 'processing', attempts int not null default 1,
      last_error text, created_at timestamptz not null default now(),
      updated_at timestamptz not null default now());
  `);
  await db.exec(await readFile(new URL("../supabase/migrations/017_clip_archive_queue.sql", import.meta.url), "utf8"));
  return db;
}

test("saving a clip queues archival, duplicate queue attempts do not duplicate work", async () => {
  const db = await database();
  try {
    const inserted = await db.query(`insert into public.clips (user_id,url,title,start_seconds,end_seconds)
      values ('11111111-1111-4111-8111-111111111111','https://www.twitch.tv/videos/123','Clip',2,32)
      returning id,archive_status`);
    const id = inserted.rows[0].id;
    assert.equal(inserted.rows[0].archive_status, "pending");
    assert.equal((await db.query("select count(*)::int as n from public.clip_archive_jobs")).rows[0].n, 1);
    const job = await db.query("select * from public.claim_clip_archive_job()");
    assert.equal(job.rows[0].clip_id, id);
    assert.equal((await db.query("select count(*)::int as n from public.claim_clip_archive_job()")).rows[0].n, 0);
    await db.query("select public.finish_clip_archive_job($1,$2,$3,$4,$5)",
      [id, `11111111-1111-4111-8111-111111111111/${id}/master.mp4`,
        `11111111-1111-4111-8111-111111111111/${id}/proxy.mp4`,
        `11111111-1111-4111-8111-111111111111/${id}/poster.jpg`, 12345]);
    assert.equal((await db.query("select archive_status from public.clips where id=$1", [id])).rows[0].archive_status, "stored");
    assert.equal((await db.query("select status from public.clip_archive_jobs where clip_id=$1", [id])).rows[0].status, "done");
  } finally { await db.close(); }
});

test("failed archive can retry and source loss is recorded without deleting clip", async () => {
  const db = await database();
  try {
    const inserted = await db.query(`insert into public.clips (user_id,url,title,start_seconds,end_seconds)
      values ('11111111-1111-4111-8111-111111111111','https://www.twitch.tv/videos/123','Clip',2,32) returning id`);
    const id = inserted.rows[0].id;
    await db.query("select * from public.claim_clip_archive_job()");
    await db.query("select public.fail_clip_archive_job($1,$2,$3,$4)", [id, "network failed", 0, false]);
    assert.equal((await db.query("select archive_status from public.clips where id=$1", [id])).rows[0].archive_status, "failed");
    assert.equal((await db.query("select * from public.claim_clip_archive_job()")).rows[0].attempts, 2);
    await db.query("select public.fail_clip_archive_job($1,$2,$3,$4)", [id, "source gone", 0, true]);
    assert.equal((await db.query("select archive_status from public.clips where id=$1", [id])).rows[0].archive_status, "unavailable");
    assert.equal((await db.query("select count(*)::int as n from public.clips where id=$1", [id])).rows[0].n, 1);
  } finally { await db.close(); }
});
