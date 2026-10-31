import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const user = '11111111-1111-4111-8111-111111111111';
const clip = '22222222-2222-4222-8222-222222222222';
const manifest = ['master.mp4', 'proxy.mp4', 'poster.jpg'].map(name => ({
  name, key: `clips/${user}/${clip}/${name}`, bytes: 20, sha256: 'a'.repeat(64),
}));

async function database() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    create table public.profiles(id uuid primary key references auth.users(id) on delete cascade, tier text not null);
    create table public.clips(id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
      url text not null, start_seconds numeric not null, end_seconds numeric not null,
      archive_status text not null default 'none', archive_error text, archive_bytes bigint,
      master_path text, proxy_path text, poster_path text, archived_at timestamptz, created_at timestamptz default now());
    create table public.clip_archive_jobs(clip_id uuid primary key references public.clips(id) on delete cascade,
      status text not null, lease_until timestamptz, last_error text, updated_at timestamptz default now());
    create table public.analysis_jobs(id uuid primary key,user_id uuid,source_key text,status text,
      created_at timestamptz default now(),heartbeat_at timestamptz);
  `);
  for (const name of ['030_r2_vod_uploads.sql', '031_r2_clip_archive.sql',
    '032_r2_retention.sql', '033_r2_usage.sql']) await db.exec(await migration(name));
  await db.query('insert into auth.users(id) values($1)', [user]);
  await db.query("insert into public.profiles(id,tier) values($1,'free')", [user]);
  return db;
}

test('new verified R2 backup gets five days, upgrade extends to 30, downgrade preserves promise', async () => {
  const db = await database();
  try {
    await db.query(`insert into public.clips(id,user_id,url,start_seconds,end_seconds,archive_status)
      values($1,$2,'upload:sample',0,30,'processing')`, [clip, user]);
    await db.query("insert into public.clip_archive_jobs(clip_id,status) values($1,'processing')", [clip]);
    await db.query('select public.finish_clip_archive_job_r2($1,$2::jsonb)', [clip, JSON.stringify(manifest)]);
    const first = (await db.query('select archive_status,media_expires_at from public.clips where id=$1', [clip])).rows[0];
    assert.equal(first.archive_status, 'stored');
    const days = (new Date(first.media_expires_at).getTime() - Date.now()) / 86400000;
    assert.ok(days > 4.9 && days < 5.1);
    await db.query("update public.profiles set tier='pro' where id=$1", [user]);
    const extended = (await db.query('select media_expires_at from public.clips where id=$1', [clip])).rows[0].media_expires_at;
    assert.ok(new Date(extended).getTime() > Date.now() + 29 * 86400000);
    await db.query("update public.profiles set tier='free' where id=$1", [user]);
    assert.equal(new Date((await db.query('select media_expires_at from public.clips where id=$1', [clip])).rows[0].media_expires_at).getTime(), new Date(extended).getTime());
  } finally { await db.close(); }
});

test('expiry enqueues three objects and a restart can reclaim a leased cleanup', async () => {
  const db = await database();
  try {
    await db.query(`insert into public.clips(id,user_id,url,start_seconds,end_seconds,archive_status)
      values($1,$2,'upload:sample',0,30,'processing')`, [clip, user]);
    await db.query("insert into public.clip_archive_jobs(clip_id,status) values($1,'processing')", [clip]);
    await db.query('select public.finish_clip_archive_job_r2($1,$2::jsonb)', [clip, JSON.stringify(manifest)]);
    await db.query("update public.clips set media_expires_at=now()-interval '2 hours' where id=$1", [clip]);
    assert.equal((await db.query('select public.schedule_expired_r2_media() as n')).rows[0].n, 1);
    assert.equal((await db.query('select public.schedule_expired_r2_media() as n')).rows[0].n, 0);
    assert.equal((await db.query("select count(*)::int as n from public.r2_cleanup_objects where operation='delete'")).rows[0].n, 3);
    assert.equal((await db.query('select archive_status from public.clips where id=$1', [clip])).rows[0].archive_status, 'expired');
    await db.exec("update public.r2_cleanup_objects set not_before=now()-interval '1 minute'");
    const claimed = (await db.query('select * from public.claim_r2_cleanup_object()')).rows[0];
    assert.ok(claimed.job_id);
    assert.equal((await db.query('select count(*)::int as n from public.claim_r2_cleanup_object()')).rows[0].n, 1);
    await db.query("update public.r2_cleanup_objects set lease_until=now()-interval '1 minute' where id=$1", [claimed.job_id]);
    assert.equal((await db.query('select * from public.claim_r2_cleanup_object()')).rows[0].job_id, claimed.job_id);
  } finally { await db.close(); }
});

test('a new Pro backup receives thirty days', async () => {
  const db = await database();
  try {
    await db.query("update public.profiles set tier='pro' where id=$1", [user]);
    await db.query(`insert into public.clips(id,user_id,url,start_seconds,end_seconds,archive_status)
      values($1,$2,'upload:sample',0,30,'processing')`, [clip, user]);
    await db.query("insert into public.clip_archive_jobs(clip_id,status) values($1,'processing')", [clip]);
    await db.query('select public.finish_clip_archive_job_r2($1,$2::jsonb)', [clip, JSON.stringify(manifest)]);
    const expiry = (await db.query('select media_expires_at from public.clips where id=$1', [clip])).rows[0].media_expires_at;
    assert.ok((new Date(expiry).getTime() - Date.now()) / 86400000 > 29.9);
  } finally { await db.close(); }
});

test('migrating an older Supabase clip leaves its existing expiry promise unchanged', async () => {
  const db = await database();
  try {
    await db.query(`insert into public.clips
      (id,user_id,url,start_seconds,end_seconds,archive_status,master_path,proxy_path,poster_path)
      values($1,$2,'https://www.twitch.tv/videos/1',0,30,'stored','old/master.mp4','old/proxy.mp4','old/poster.jpg')`,
      [clip, user]);
    await db.query('select public.mark_clip_migrated_to_r2($1,$2::jsonb)', [clip, JSON.stringify(manifest)]);
    const row = (await db.query('select archive_provider,media_expires_at from public.clips where id=$1', [clip])).rows[0];
    assert.equal(row.archive_provider, 'r2');
    assert.equal(row.media_expires_at, null);
    assert.equal((await db.query('select legacy_master_path from public.clip_r2_migrations where clip_id=$1', [clip])).rows[0].legacy_master_path, 'old/master.mp4');
  } finally { await db.close(); }
});

test('deleting a user retains orphan cleanup keys before manifest cascades', async () => {
  const db = await database();
  try {
    await db.query(`insert into public.clips(id,user_id,url,start_seconds,end_seconds,archive_status)
      values($1,$2,'upload:sample',0,30,'processing')`, [clip, user]);
    await db.query("insert into public.clip_archive_jobs(clip_id,status) values($1,'processing')", [clip]);
    await db.query('select public.finish_clip_archive_job_r2($1,$2::jsonb)', [clip, JSON.stringify(manifest)]);
    await db.query('delete from auth.users where id=$1', [user]);
    assert.equal((await db.query('select count(*)::int as n from public.r2_cleanup_objects')).rows[0].n, 3);
  } finally { await db.close(); }
});

test('expired VOD waits for an active analysis and queues deletion afterward', async () => {
  const db = await database();
  const upload = '33333333-3333-4333-8333-333333333333';
  try {
    await db.query(`insert into public.vod_uploads
      (id,user_id,object_key,remote_upload_id,file_name,expected_bytes,status,duration_seconds,
       session_expires_at,ready_at,source_expires_at)
      values($1,$2,$3,'multipart','source.mp4',100,'ready',60,
       now()-interval '10 days',now()-interval '10 days',now()-interval '1 day')`,
      [upload,user,`vod/${user}/${upload}/source.mp4`]);
    await db.query(`insert into public.analysis_jobs(id,user_id,source_key,status,heartbeat_at)
      values('44444444-4444-4444-8444-444444444444',$1,$2,'running',now())`, [user,`upload:${upload}`]);
    assert.equal((await db.query('select public.schedule_expired_r2_media() as n')).rows[0].n, 0);
    await db.query("update public.analysis_jobs set status='completed'");
    assert.equal((await db.query('select public.schedule_expired_r2_media() as n')).rows[0].n, 1);
    assert.equal((await db.query('select status from public.vod_uploads where id=$1', [upload])).rows[0].status, 'expired');
    assert.equal((await db.query('select operation from public.r2_cleanup_objects')).rows[0].operation, 'delete');
  } finally { await db.close(); }
});

test('unfinished multipart uploads are bounded per account', async () => {
  const db = await database();
  try {
    const insert = id => db.query(`insert into public.vod_uploads
      (id,user_id,object_key,remote_upload_id,file_name,expected_bytes,session_expires_at)
      values($1,$2,$3,'multipart','source.mp4',100,now()+interval '1 hour')`,
      [id,user,`vod/${user}/${id}/source.mp4`]);
    await insert('33333333-3333-4333-8333-333333333333');
    await insert('44444444-4444-4444-8444-444444444444');
    await assert.rejects(insert('55555555-5555-4555-8555-555555555555'), /Too many unfinished/);
  } finally { await db.close(); }
});
