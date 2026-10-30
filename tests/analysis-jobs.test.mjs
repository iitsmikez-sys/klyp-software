import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const user = "11111111-1111-4111-8111-111111111111";
const job = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

async function database() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users (id uuid primary key);
    insert into auth.users values ('${user}');
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;
    create table public.profiles (id uuid primary key, sparks integer not null, tier text not null default 'free');
    create function public.tier_allowance(t text) returns integer language sql immutable
      as $$ select case t when 'pro' then 500 else 150 end $$;
    create table public.clips (id uuid primary key default gen_random_uuid(), user_id uuid not null,
      url text not null, start_seconds double precision not null, end_seconds double precision not null,
      created_at timestamptz not null default now());
    insert into public.profiles (id,sparks) values ('${user}',200);
    set app.user_id = '${user}';
  `);
  await db.exec(await readFile(new URL("../supabase/migrations/012_sparks_ledger.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../supabase/migrations/014_analysis_clip_history.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../supabase/migrations/006_transcripts.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../supabase/migrations/020_transcript_owner_default.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../supabase/migrations/028_analysis_jobs.sql", import.meta.url), "utf8"));
  return db;
}

test("job id is durable and scoped to one user", async () => {
  const db = await database();
  try {
    await db.query(`insert into public.analysis_jobs
      (id,user_id,source_key,input_hash,request_payload)
      values ($1,$2,'twitch:1','hash-1','{}'::jsonb)`, [job, user]);
    const rows = await db.query("select status,stage from public.analysis_jobs where id=$1", [job]);
    assert.deepEqual(rows.rows[0], { status: "queued", stage: "download" });
    await assert.rejects(db.query(`insert into public.analysis_jobs
      (id,user_id,source_key,input_hash,request_payload)
      values ($1,$2,'twitch:1','hash-1','{}'::jsonb)`, [job, user]));
  } finally { await db.close(); }
});

test("transcript and analysis checkpoints survive a failed request", async () => {
  const db = await database();
  try {
    await db.query(`insert into public.analysis_jobs
      (id,user_id,source_key,input_hash,request_payload)
      values ($1,$2,'twitch:1','hash-1','{}'::jsonb)`, [job, user]);
    await db.query(`insert into public.transcripts
      (user_id,url,duration_seconds,words,transcript_text,analysis_job_id,source_key,coverage_mode)
      values ($1,'https://www.twitch.tv/videos/1',3600,'[{"text":"hello","start":0,"end":500}]'::jsonb,'hello',$2,'twitch:1','full')`, [user, job]);
    await db.query(`update public.analysis_jobs set status='failed',analysis_clips='[]'::jsonb,
      analysis_duration_seconds=3600,transcript_chars=5 where id=$1`, [job]);
    const result = await db.query(`select j.analysis_clips,t.words from public.analysis_jobs j
      join public.transcripts t on t.analysis_job_id=j.id where j.id=$1`, [job]);
    assert.equal(result.rows.length, 1);
    assert.deepEqual(result.rows[0].analysis_clips, []);
    assert.equal(result.rows[0].words[0].text, "hello");
  } finally { await db.close(); }
});

test("retry claims a failed job and uses its existing transcript checkpoint", async () => {
  const db = await database();
  try {
    await db.query(`insert into public.analysis_jobs
      (id,user_id,source_key,input_hash,request_payload,status,attempts)
      values ($1,$2,'twitch:1','hash-1','{}'::jsonb,'failed',1)`, [job, user]);
    await db.query(`insert into public.transcripts
      (user_id,url,duration_seconds,words,transcript_text,analysis_job_id,source_key,coverage_mode)
      values ($1,'https://www.twitch.tv/videos/1',3600,'[{"text":"hello","start":0,"end":500}]'::jsonb,'hello',$2,'twitch:1','full')`, [user, job]);
    await db.query(`update public.analysis_jobs set status='running',attempts=attempts+1,
      run_token=gen_random_uuid() where id=$1 and status='failed'`, [job]);
    const rows = await db.query(`select j.status,j.attempts,t.words from public.analysis_jobs j
      join public.transcripts t on t.analysis_job_id=j.id where j.id=$1`, [job]);
    assert.equal(rows.rows[0].status, "running");
    assert.equal(rows.rows[0].attempts, 2);
    assert.equal(rows.rows[0].words[0].text, "hello");
    const count = await db.query("select count(*)::int as n from public.transcripts where analysis_job_id=$1", [job]);
    assert.equal(count.rows[0].n, 1);
  } finally { await db.close(); }
});

test("one completed full transcript is reusable by a new intentional job", async () => {
  const db = await database();
  try {
    await db.query(`insert into public.analysis_jobs
      (id,user_id,source_key,input_hash,request_payload)
      values ($1,$2,'twitch:1','hash-1','{}'::jsonb)`, [job, user]);
    await db.query(`insert into public.transcripts
      (user_id,url,duration_seconds,words,transcript_text,analysis_job_id,source_key,coverage_mode)
      values ($1,'https://www.twitch.tv/videos/1',3600,'[]'::jsonb,'',$2,'twitch:1','full')`, [user, job]);
    const rows = await db.query(`select words from public.transcripts where user_id=$1
      and source_key='twitch:1' and coverage_mode='full' order by created_at desc limit 1`, [user]);
    assert.equal(rows.rows.length, 1);
  } finally { await db.close(); }
});

test("duplicate active intent is rejected but completed intent permits reanalysis", async () => {
  const db = await database();
  try {
    await db.query(`insert into public.analysis_jobs (id,user_id,source_key,input_hash,request_payload)
      values ($1,$2,'twitch:1','same-settings','{}'::jsonb)`, [job, user]);
    await assert.rejects(db.query(`insert into public.analysis_jobs (id,user_id,source_key,input_hash,request_payload)
      values (gen_random_uuid(),$1,'twitch:1','same-settings','{}'::jsonb)`, [user]));
    await db.query("update public.analysis_jobs set status='completed' where id=$1", [job]);
    await db.query(`insert into public.analysis_jobs (id,user_id,source_key,input_hash,request_payload)
      values (gen_random_uuid(),$1,'twitch:1','same-settings','{}'::jsonb)`, [user]);
    const rows = await db.query("select count(*)::int as n from public.analysis_jobs where source_key='twitch:1'");
    assert.equal(rows.rows[0].n, 2);
  } finally { await db.close(); }
});

test("transcript reuse excludes chat-sampled and other-user rows", async () => {
  const db = await database();
  const other = "22222222-2222-4222-8222-222222222222";
  try {
    await db.query("insert into auth.users values ($1)", [other]);
    await db.query(`insert into public.transcripts
      (user_id,url,duration_seconds,words,transcript_text,source_key,coverage_mode)
      values ($1,'https://www.twitch.tv/videos/1',7200,'[]'::jsonb,'','twitch:1','chat-sampled'),
      ($2,'https://www.twitch.tv/videos/1',7200,'[]'::jsonb,'','twitch:1','full')`, [user, other]);
    const rows = await db.query(`select id from public.transcripts where user_id=$1
      and source_key='twitch:1' and coverage_mode='full'`, [user]);
    assert.equal(rows.rows.length, 0);
  } finally { await db.close(); }
});

test("accounting and durable result commit once even if result delivery is lost", async () => {
  const db = await database();
  const runToken = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  try {
    await db.query(`insert into public.analysis_jobs
      (id,user_id,source_key,input_hash,request_payload,status,run_token,transcript_chars)
      values ($1,$2,'twitch:1','hash-1','{}'::jsonb,'running',$3,100)`, [job, user, runToken]);
    const clips = [{ start_seconds: 100, end_seconds: 130, title: "Moment" }];
    const first = await db.query("select public.record_analysis_job_clips($1,$2,$3::jsonb,3600,3) as result",
      [job, runToken, JSON.stringify(clips)]);
    const second = await db.query("select public.record_analysis_job_clips($1,$2,$3::jsonb,3600,3) as result",
      [job, runToken, JSON.stringify(clips)]);
    assert.deepEqual(first.rows[0].result, second.rows[0].result);
    assert.equal(first.rows[0].result.sparksSpent, 38);
    assert.equal(first.rows[0].result.clips.length, 1);
    const ledger = await db.query("select count(*)::int as n from public.spark_transactions where reason='analysis'");
    assert.equal(ledger.rows[0].n, 1);
  } finally { await db.close(); }
});
