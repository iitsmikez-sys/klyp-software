-- Durable, private analysis intents and provider checkpoints. Apply after
-- 024–027; do not replace the VOD discovery cache in 024.
begin;

create table if not exists public.analysis_jobs (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  source_key text not null,
  input_hash text not null,
  request_payload jsonb not null,
  status text not null default 'queued' check (status in ('queued','running','completed','failed')),
  stage text not null default 'download' check (stage in ('download','transcribe','analyze')),
  error text,
  analysis_clips jsonb,
  analysis_duration_seconds double precision,
  transcript_chars integer,
  result jsonb,
  attempts integer not null default 0,
  run_token uuid,
  heartbeat_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists analysis_jobs_user_created_idx
  on public.analysis_jobs (user_id, created_at desc);
create index if not exists analysis_jobs_user_source_idx
  on public.analysis_jobs (user_id, source_key, created_at desc);
-- Two clicks or two tabs with identical settings must share one active job.
create unique index if not exists analysis_jobs_one_active_input
  on public.analysis_jobs (user_id, source_key, input_hash)
  where status in ('queued', 'running');

alter table public.analysis_jobs enable row level security;
revoke all on public.analysis_jobs from anon, authenticated;
grant all on public.analysis_jobs to service_role;

alter table public.transcripts
  add column if not exists analysis_job_id uuid references public.analysis_jobs(id) on delete set null,
  add column if not exists source_key text,
  add column if not exists coverage_mode text;
create unique index if not exists transcripts_analysis_job_id_unique
  on public.transcripts (analysis_job_id) where analysis_job_id is not null;
create index if not exists transcripts_reuse_idx
  on public.transcripts (user_id, source_key, coverage_mode, created_at desc)
  where source_key is not null and coverage_mode = 'full';

-- Keep the existing clip-history/Sparks transaction intact, and commit its
-- customer-visible result in the SAME transaction. A dropped response can be
-- fetched later without recharging or discarding accepted clips.
create or replace function public.record_analysis_job_clips(
  p_job_id uuid, p_run_token uuid, p_clips jsonb,
  p_duration_seconds double precision, p_requested_clips integer
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_job public.analysis_jobs%rowtype;
  v_charge record;
  v_clips jsonb;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into v_job from public.analysis_jobs
    where id = p_job_id and user_id = auth.uid() for update;
  if not found then raise exception 'analysis job not found'; end if;
  if v_job.status = 'completed' then return v_job.result; end if;
  if v_job.status <> 'running' or v_job.run_token is distinct from p_run_token then
    raise exception 'analysis job is not owned by this attempt';
  end if;
  if p_clips is null or jsonb_typeof(p_clips) <> 'array' then
    raise exception 'invalid analysis clips';
  end if;
  if v_job.analysis_clips is not null and v_job.analysis_clips is distinct from p_clips then
    raise exception 'analysis checkpoint differs from accounting input';
  end if;
  select * into v_charge from public.record_analysis_clips(
    v_job.source_key, p_clips, p_duration_seconds, p_requested_clips);
  select coalesce(jsonb_agg(p_clips -> n.idx order by n.ord), '[]'::jsonb)
    into v_clips from unnest(v_charge.accepted_indices) with ordinality as n(idx, ord);
  v_result := jsonb_build_object(
    'type', 'result', 'clips', v_clips,
    'durationSeconds', p_duration_seconds,
    'transcriptChars', coalesce(v_job.transcript_chars, 0),
    'requestedClips', p_requested_clips,
    'sparksSpent', v_charge.sparks_spent,
    'sparksBalance', v_charge.sparks_balance
  );
  update public.analysis_jobs set status = 'completed', stage = 'analyze',
    analysis_clips = p_clips, result = v_result, error = null,
    updated_at = now(), heartbeat_at = now()
    where id = p_job_id;
  return v_result;
end $$;
revoke all on function public.record_analysis_job_clips(uuid, uuid, jsonb, double precision, integer) from public, anon;
grant execute on function public.record_analysis_job_clips(uuid, uuid, jsonb, double precision, integer) to authenticated;
notify pgrst, 'reload schema';

commit;
