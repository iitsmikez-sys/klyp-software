import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

async function database(dataDir) {
  const db = new PGlite(dataDir);
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema storage;
    create table storage.buckets (id text primary key, name text not null,
      public boolean not null, file_size_limit bigint);
    create table storage.objects (bucket_id text not null, name text not null,
      primary key (bucket_id, name));
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    create table public.clips (id uuid primary key default gen_random_uuid(),
      user_id uuid not null, url text not null, title text not null,
      start_seconds numeric not null, end_seconds numeric not null,
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
  await db.exec(await readFile(new URL("../supabase/migrations/027_archive_confirmation_guard.sql", import.meta.url), "utf8"));
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
    assert.equal((await db.query("select archived_at, master_path from public.clips where id=$1", [id])).rows[0].archived_at, null);
    assert.equal((await db.query("select count(*)::int as n from public.clip_archive_jobs")).rows[0].n, 1);
    const job = await db.query("select * from public.claim_clip_archive_job()");
    assert.equal(job.rows[0].clip_id, id);
    assert.equal((await db.query("select count(*)::int as n from public.claim_clip_archive_job()")).rows[0].n, 0);
    const base = `11111111-1111-4111-8111-111111111111/${id}/`;
    await assert.rejects(db.query("select public.finish_clip_archive_job($1,$2,$3,$4,$5)",
      [id, `${base}master.mp4`, `${base}proxy.mp4`, `${base}poster.jpg`, 12345]), /missing|not stored/i);
    assert.equal((await db.query("select archive_status from public.clips where id=$1", [id])).rows[0].archive_status, "processing");
    for (const name of ['master.mp4', 'proxy.mp4', 'poster.jpg']) {
      await db.query("insert into storage.objects (bucket_id,name) values ($1,$2)", ['clip-media', `${base}${name}`]);
    }
    await db.query("select public.finish_clip_archive_job($1,$2,$3,$4,$5)",
      [id, `11111111-1111-4111-8111-111111111111/${id}/master.mp4`,
        `11111111-1111-4111-8111-111111111111/${id}/proxy.mp4`,
        `11111111-1111-4111-8111-111111111111/${id}/poster.jpg`, 12345]);
    assert.equal((await db.query("select archive_status from public.clips where id=$1", [id])).rows[0].archive_status, "stored");
    assert.equal((await db.query("select status from public.clip_archive_jobs where clip_id=$1", [id])).rows[0].status, "done");
    assert.equal((await db.query("select public.finish_clip_archive_job($1,$2,$3,$4,$5) as changed",
      [id, `11111111-1111-4111-8111-111111111111/${id}/master.mp4`,
        `11111111-1111-4111-8111-111111111111/${id}/proxy.mp4`,
        `11111111-1111-4111-8111-111111111111/${id}/poster.jpg`, 12345])).rows[0].changed, false);
  } finally { await db.close(); }
});

test('an authenticated insert cannot forge a confirmed backup', async () => {
  const db = await database();
  try {
    const inserted = await db.query(`insert into public.clips
      (user_id,url,title,start_seconds,end_seconds,archive_status,master_path,proxy_path,poster_path,archived_at)
      values ('11111111-1111-4111-8111-111111111111','https://www.twitch.tv/videos/123','Clip',2,32,
        'stored','fake/master.mp4','fake/proxy.mp4','fake/poster.jpg',now())
      returning id,archive_status,master_path,proxy_path,poster_path,archived_at`);
    assert.equal(inserted.rows[0].archive_status, 'pending');
    assert.equal(inserted.rows[0].master_path, null);
    assert.equal(inserted.rows[0].proxy_path, null);
    assert.equal(inserted.rows[0].poster_path, null);
    assert.equal(inserted.rows[0].archived_at, null);
    assert.equal((await db.query('select count(*)::int as n from public.clip_archive_jobs')).rows[0].n, 1);
  } finally { await db.close(); }
});

test('the oldest unarchived clip is claimed first so new saves cannot starve it', async () => {
  const db = await database();
  try {
    const older = await db.query(`insert into public.clips (user_id,url,title,start_seconds,end_seconds,created_at)
      values ('11111111-1111-4111-8111-111111111111','https://www.twitch.tv/videos/123','Older',2,32,now() - interval '1 hour') returning id`);
    await db.query(`insert into public.clips (user_id,url,title,start_seconds,end_seconds)
      values ('11111111-1111-4111-8111-111111111111','https://www.twitch.tv/videos/123','Newer',2,32)`);
    assert.equal((await db.query('select * from public.claim_clip_archive_job()')).rows[0].clip_id, older.rows[0].id);
  } finally { await db.close(); }
});

test("an interrupted archive is reclaimed after its lease expires without falsely confirming the clip", async () => {
  const db = await database();
  try {
    const inserted = await db.query(`insert into public.clips (user_id,url,title,start_seconds,end_seconds)
      values ('11111111-1111-4111-8111-111111111111','https://www.twitch.tv/videos/123','Clip',2,32) returning id`);
    const id = inserted.rows[0].id;
    await db.query("select * from public.claim_clip_archive_job()");
    assert.equal((await db.query("select archive_status from public.clips where id=$1", [id])).rows[0].archive_status, "processing");
    assert.equal((await db.query("select count(*)::int as n from public.claim_clip_archive_job()")).rows[0].n, 0);
    await db.query("update public.clip_archive_jobs set lease_until = now() - interval '1 second' where clip_id=$1", [id]);
    assert.equal((await db.query("select * from public.claim_clip_archive_job()")).rows[0].clip_id, id);
    assert.equal((await db.query("select archive_status,master_path from public.clips where id=$1", [id])).rows[0].master_path, null);
  } finally { await db.close(); }
});

test('an archive job survives a database close and reopen after an interrupted worker', async () => {
  const parent = new URL('../.tmp-smoke/', import.meta.url);
  await mkdir(parent, { recursive: true });
  const dir = await mkdtemp(path.join(fileURLToPath(parent), 'klyp-archive-restart-'));
  let db;
  try {
    db = await database(dir);
    const inserted = await db.query(`insert into public.clips (user_id,url,title,start_seconds,end_seconds)
      values ('11111111-1111-4111-8111-111111111111','https://www.twitch.tv/videos/123','Clip',2,32) returning id`);
    const id = inserted.rows[0].id;
    await db.query('select * from public.claim_clip_archive_job()');
    await db.query("update public.clip_archive_jobs set lease_until = now() - interval '1 second' where clip_id=$1", [id]);
    await db.close();
    db = new PGlite(dir);
    assert.equal((await db.query('select * from public.claim_clip_archive_job()')).rows[0].clip_id, id);
    assert.equal((await db.query('select archive_status from public.clips where id=$1', [id])).rows[0].archive_status, 'processing');
  } finally {
    if (db) await db.close();
    await rm(dir, { recursive: true, force: true });
  }
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
