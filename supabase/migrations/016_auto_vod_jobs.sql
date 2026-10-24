-- Durable, idempotent Twitch VOD processing. Apply after 015, before deploying
-- the processing worker that calls these RPCs.
begin;

create table if not exists public.auto_vod_jobs (
  id uuid primary key default gen_random_uuid(),
  stream_id uuid not null references public.streams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  video_id text not null,
  url text not null,
  duration_seconds integer not null check (duration_seconds > 0 and duration_seconds <= 604800),
  status text not null default 'pending' check (status in ('pending', 'processing', 'retry', 'failed', 'succeeded', 'canceled')),
  attempts integer not null default 0,
  retry_at timestamptz not null default now(),
  lease_until timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (stream_id, video_id)
);
create index if not exists auto_vod_jobs_due_idx on public.auto_vod_jobs (retry_at)
  where status in ('pending', 'retry', 'processing');
alter table public.auto_vod_jobs enable row level security;
drop policy if exists "read own auto vod jobs" on public.auto_vod_jobs;
create policy "read own auto vod jobs" on public.auto_vod_jobs
  for select to authenticated using (auth.uid() = user_id);
revoke all on public.auto_vod_jobs from public, anon, authenticated;
grant select on public.auto_vod_jobs to authenticated;
grant all on public.auto_vod_jobs to service_role;

create or replace function public.enqueue_auto_vod_job(
  p_stream_id uuid, p_video_id text, p_url text, p_duration_seconds integer
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_user_id uuid; v_enabled boolean;
begin
  if p_video_id is null or p_video_id !~ '^[0-9]+$'
    or p_url <> 'https://www.twitch.tv/videos/' || p_video_id
    or p_duration_seconds is null or p_duration_seconds <= 0 or p_duration_seconds > 604800 then
    raise exception 'invalid Twitch VOD';
  end if;
  select user_id, auto_clip_enabled into v_user_id, v_enabled
    from public.streams where id = p_stream_id;
  if v_user_id is null then raise exception 'stream not found'; end if;
  if not coalesce(v_enabled, false) then raise exception 'auto-clipping disabled'; end if;
  insert into public.auto_vod_jobs (stream_id, user_id, video_id, url, duration_seconds)
    values (p_stream_id, v_user_id, p_video_id, p_url, p_duration_seconds)
    on conflict (stream_id, video_id) do nothing returning id into v_id;
  if v_id is null then
    select id into v_id from public.auto_vod_jobs
      where stream_id = p_stream_id and video_id = p_video_id;
  end if;
  return v_id;
end $$;

create or replace function public.claim_auto_vod_job()
returns table(id uuid, stream_id uuid, user_id uuid, video_id text, url text,
  duration_seconds integer, attempts integer)
language plpgsql security definer set search_path = public as $$
declare v_job public.auto_vod_jobs;
begin
  select * into v_job from public.auto_vod_jobs j
    where (j.status in ('pending', 'retry') and j.retry_at <= now())
       or (j.status = 'processing' and j.lease_until < now())
    order by j.created_at for update skip locked limit 1;
  if v_job.id is null then return; end if;
  update public.auto_vod_jobs j set status = 'processing', attempts = j.attempts + 1,
    lease_until = now() + interval '60 minutes', updated_at = now()
    where j.id = v_job.id;
  return query select j.id, j.stream_id, j.user_id, j.video_id, j.url,
    j.duration_seconds, j.attempts from public.auto_vod_jobs j where j.id = v_job.id;
end $$;

create or replace function public.finish_auto_vod_job(
  p_job_id uuid, p_clips jsonb, p_cost integer
) returns boolean language plpgsql security definer set search_path = public as $$
declare v_job public.auto_vod_jobs; v_balance integer; v_inserted integer; v_enabled boolean;
begin
  select * into v_job from public.auto_vod_jobs where id = p_job_id for update;
  if v_job.id is null then raise exception 'auto VOD job not found'; end if;
  if v_job.status in ('succeeded', 'canceled') then return false; end if;
  if v_job.status <> 'processing' then raise exception 'auto VOD job is not claimed'; end if;
  select auto_clip_enabled into v_enabled from public.streams
    where id = v_job.stream_id for update;
  if not coalesce(v_enabled, false) then
    update public.auto_vod_jobs set status = 'canceled', lease_until = null,
      updated_at = now() where id = p_job_id;
    return false;
  end if;
  if p_clips is null or jsonb_typeof(p_clips) <> 'array'
    or jsonb_array_length(p_clips) > 20 or p_cost is null or p_cost < 0 or p_cost > 1000 then
    raise exception 'invalid auto VOD result';
  end if;
  select sparks into v_balance from public.profiles where id = v_job.user_id for update;
  if v_balance < p_cost then raise exception 'insufficient sparks: need %, have %', p_cost, v_balance; end if;

  insert into public.clips (user_id, url, title, clip_type, viral_score, caption, reason,
    start_seconds, end_seconds, hooks, words, dim_hype, dim_emotion, dim_skill,
    dim_comedy, dim_storyline)
  select v_job.user_id, v_job.url, c.title, c.clip_type, c.viral_score, c.caption,
    c.reason, c.start_seconds, c.end_seconds, c.hooks, c.words, c.dim_hype,
    c.dim_emotion, c.dim_skill, c.dim_comedy, c.dim_storyline
  from jsonb_to_recordset(p_clips) as c(title text, clip_type text, viral_score integer,
    caption text, reason text, start_seconds double precision, end_seconds double precision,
    hooks jsonb, words jsonb, dim_hype integer, dim_emotion integer, dim_skill integer,
    dim_comedy integer, dim_storyline integer)
  where c.title is not null and c.clip_type is not null and c.viral_score between 1 and 100
    and c.start_seconds >= 0 and c.end_seconds > c.start_seconds
    and c.end_seconds <= v_job.duration_seconds;
  get diagnostics v_inserted = row_count;
  if v_inserted <> jsonb_array_length(p_clips) then
    raise exception 'invalid auto VOD clip data';
  end if;

  update public.profiles set sparks = sparks - p_cost where id = v_job.user_id
    returning sparks into v_balance;
  if p_cost > 0 then
    insert into public.spark_transactions (user_id, delta, reason, reference, balance_after)
      values (v_job.user_id, -p_cost, 'auto_clip', 'twitch:' || v_job.video_id, v_balance);
  end if;
  update public.auto_vod_jobs set status = 'succeeded', lease_until = null,
    last_error = null, updated_at = now() where id = p_job_id;
  update public.streams set last_seen_video_id = v_job.video_id
    where id = v_job.stream_id and
      (last_seen_video_id is null or last_seen_video_id::numeric < v_job.video_id::numeric);
  return true;
end $$;

create or replace function public.fail_auto_vod_job(
  p_job_id uuid, p_error text, p_retry_seconds integer
) returns text language plpgsql security definer set search_path = public as $$
declare v_job public.auto_vod_jobs; v_status text;
begin
  select * into v_job from public.auto_vod_jobs where id = p_job_id for update;
  if v_job.id is null then raise exception 'auto VOD job not found'; end if;
  if v_job.status in ('succeeded', 'canceled') then return v_job.status; end if;
  v_status := case when v_job.attempts >= 5 then 'failed' else 'retry' end;
  update public.auto_vod_jobs set status = v_status, lease_until = null,
    retry_at = now() + make_interval(secs => greatest(0, least(coalesce(p_retry_seconds, 120), 86400))),
    last_error = left(coalesce(p_error, 'Processing failed'), 500), updated_at = now()
    where id = p_job_id;
  return v_status;
end $$;

revoke all on function public.enqueue_auto_vod_job(uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.claim_auto_vod_job() from public, anon, authenticated;
revoke all on function public.finish_auto_vod_job(uuid, jsonb, integer) from public, anon, authenticated;
revoke all on function public.fail_auto_vod_job(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.enqueue_auto_vod_job(uuid, text, text, integer) to service_role;
grant execute on function public.claim_auto_vod_job() to service_role;
grant execute on function public.finish_auto_vod_job(uuid, jsonb, integer) to service_role;
grant execute on function public.fail_auto_vod_job(uuid, text, integer) to service_role;
notify pgrst, 'reload schema';
commit;
