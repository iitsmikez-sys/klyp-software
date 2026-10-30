-- Experimental VOD discovery cache. Apply only with the new worker; no existing rows are trusted.
begin;
create table if not exists public.analysis_transcript_cache (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_key text not null,
  vod_seconds double precision not null check (vod_seconds > 0 and vod_seconds <= 604800),
  version text not null,
  model text not null,
  start_seconds double precision not null check (start_seconds >= 0),
  end_seconds double precision not null,
  actual_audio_seconds double precision not null,
  words jsonb not null check (jsonb_typeof(words) = 'array'),
  created_at timestamptz not null default now(),
  check (end_seconds > start_seconds and end_seconds <= vod_seconds),
  check (actual_audio_seconds > 0 and abs(actual_audio_seconds - (end_seconds - start_seconds)) <= 2),
  unique (user_id, source_key, version, model, start_seconds, end_seconds)
);
create index if not exists analysis_transcript_cache_lookup
  on public.analysis_transcript_cache (user_id, source_key, version, model, created_at desc);
alter table public.analysis_transcript_cache enable row level security;
drop policy if exists "read own analysis transcript cache" on public.analysis_transcript_cache;
create policy "read own analysis transcript cache" on public.analysis_transcript_cache
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "insert own analysis transcript cache" on public.analysis_transcript_cache;
create policy "insert own analysis transcript cache" on public.analysis_transcript_cache
  for insert to authenticated with check (auth.uid() = user_id);
grant select, insert on public.analysis_transcript_cache to authenticated;
grant all on public.analysis_transcript_cache to service_role;
create table if not exists public.analysis_result_cache (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_key text not null,
  vod_seconds double precision not null check (vod_seconds > 0 and vod_seconds <= 604800),
  request_hash text not null check (length(request_hash) between 1 and 128),
  clips jsonb not null check (jsonb_typeof(clips) = 'array'),
  created_at timestamptz not null default now(),
  unique (user_id, source_key, request_hash)
);
create index if not exists analysis_result_cache_lookup
  on public.analysis_result_cache (user_id, source_key, created_at desc);
alter table public.analysis_result_cache enable row level security;
drop policy if exists "read own analysis result cache" on public.analysis_result_cache;
create policy "read own analysis result cache" on public.analysis_result_cache
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "insert own analysis result cache" on public.analysis_result_cache;
create policy "insert own analysis result cache" on public.analysis_result_cache
  for insert to authenticated with check (auth.uid() = user_id);
grant select, insert on public.analysis_result_cache to authenticated;
grant all on public.analysis_result_cache to service_role;
-- The experimental worker uses a stricter paid-work retry limit; the existing
-- three-argument RPC and production retry policy remain unchanged.
create or replace function public.fail_auto_vod_job_limited(
  p_job_id uuid, p_error text, p_retry_seconds integer, p_max_attempts integer
) returns text language plpgsql security definer set search_path = public as $$
declare v_job public.auto_vod_jobs; v_status text;
begin
  select * into v_job from public.auto_vod_jobs where id = p_job_id for update;
  if v_job.id is null then raise exception 'auto VOD job not found'; end if;
  if v_job.status in ('succeeded', 'canceled') then return v_job.status; end if;
  v_status := case when v_job.attempts >= greatest(1, least(coalesce(p_max_attempts, 2), 5))
    then 'failed' else 'retry' end;
  update public.auto_vod_jobs set status = v_status, lease_until = null,
    retry_at = now() + make_interval(secs => greatest(0, least(coalesce(p_retry_seconds, 120), 86400))),
    last_error = left(coalesce(p_error, 'Processing failed'), 500), updated_at = now()
    where id = p_job_id;
  return v_status;
end $$;
revoke all on function public.fail_auto_vod_job_limited(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.fail_auto_vod_job_limited(uuid, text, integer, integer) to service_role;
notify pgrst, 'reload schema';
commit;
