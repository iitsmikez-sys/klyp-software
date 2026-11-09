-- Smart pick: a free person can clip the best 2 hours of a longer video. Clip times stay on the video's own timeline
-- (so they point at the right place and never collide with a later full analysis), while the PRICE follows the length
-- of the part that was analyzed. Both accounting functions get one optional extra argument, p_billed_seconds; leaving it
-- out behaves exactly as before. Nothing else about them changes (the pricing table, the quality-bar rule and the checks
-- are copied from migration 045 / 028).
--
-- Run this BEFORE the code that sends p_billed_seconds goes live. Safe to run again.
begin;

drop function if exists public.record_analysis_job_clips(uuid, uuid, jsonb, double precision, integer);
drop function if exists public.record_analysis_job_clips(uuid, uuid, jsonb, double precision, integer, double precision);
drop function if exists public.record_analysis_clips(text, jsonb, double precision, integer);
drop function if exists public.record_analysis_clips(text, jsonb, double precision, integer, double precision);

create function public.record_analysis_clips(
  p_source_key text, p_clips jsonb, p_duration_seconds double precision,
  p_requested_clips integer, p_billed_seconds double precision default null
)
returns table(accepted_indices integer[], sparks_spent integer, sparks_balance integer)
language plpgsql security definer set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_balance integer;
  v_start double precision;
  v_end double precision;
  v_index integer;
  v_accepted integer[] := '{}';
  v_vod_cost integer;
  v_billed double precision;
  v_cost integer;
  v_prior_count integer;
  v_top_pick boolean := false;
begin
  if v_user_id is null then raise exception 'not authenticated'; end if;
  if p_source_key is null or p_source_key !~ '^(youtube:[A-Za-z0-9_-]{11}|twitch:[0-9]+|kick:[0-9a-f-]{36}|upload:[A-Za-z0-9_-]{1,100})$'
    or p_clips is null or jsonb_typeof(p_clips) <> 'array'
    or jsonb_array_length(p_clips) > 20
    or p_duration_seconds is null or p_duration_seconds <= 0 or p_duration_seconds > 604800
    or p_requested_clips not in (1, 2, 3, 5, 7, 10, 12, 20)
    or jsonb_array_length(p_clips) > p_requested_clips
    or (p_billed_seconds is not null and (p_billed_seconds <= 0 or p_billed_seconds > p_duration_seconds)) then
    raise exception 'invalid analysis accounting input';
  end if;

  select sparks into v_balance from public.profiles where id = v_user_id for update;
  if v_balance is null then raise exception 'profile not found'; end if;
  select count(*) into v_prior_count from public.analysis_clip_history
    where user_id = v_user_id and source_key = p_source_key;

  for v_index in 0..jsonb_array_length(p_clips) - 1 loop
    if jsonb_typeof(p_clips->v_index->'start_seconds') <> 'number'
       or jsonb_typeof(p_clips->v_index->'end_seconds') <> 'number' then
      raise exception 'invalid clip window';
    end if;
    v_start := (p_clips->v_index->>'start_seconds')::double precision;
    v_end := (p_clips->v_index->>'end_seconds')::double precision;
    if v_start < 0 or v_end <= v_start or v_end > p_duration_seconds then
      raise exception 'invalid clip bounds';
    end if;
    if not exists (
      select 1 from public.analysis_clip_history h
       where h.user_id = v_user_id and h.source_key = p_source_key
         and (abs(h.start_seconds - v_start) < 60
              or (h.start_seconds < v_end and h.end_seconds > v_start))
    ) then
      insert into public.analysis_clip_history (user_id, source_key, start_seconds, end_seconds)
      values (v_user_id, p_source_key, v_start, v_end);
      v_accepted := array_append(v_accepted, v_index);
      -- A clip with no score counts as a top pick, so older callers are charged as before.
      if coalesce((p_clips->v_index->>'viral_score')::numeric, 100) >= 65 then v_top_pick := true; end if;
    end if;
  end loop;

  -- Per-video price with clips included: 20 / 35 / 50 / 65 / 80, then +20 per started hour over 6 hours.
  -- The price follows p_billed_seconds when it is given (a free person clipping a 2 hour part of a longer video), otherwise
  -- the whole length. Clip times are still checked against p_duration_seconds, the end of the part on the video's own timeline.
  v_billed := coalesce(p_billed_seconds, p_duration_seconds);
  v_vod_cost := case when v_billed < 1800 then 20
    when v_billed < 3600 then 35
    when v_billed < 7200 then 50
    when v_billed <= 14400 then 65
    when v_billed <= 21600 then 80
    else 80 + 20 * ceil((v_billed - 21600) / 3600.0)::integer end;
  -- Nothing worth paying for, nothing to charge: no new clips, or only below-bar "best of this stream" moments,
  -- is free, whether it is the first analysis of this video or a repeat. Only a result with at least one new
  -- clip that cleared the quality bar costs the video price.
  v_cost := case when v_top_pick then v_vod_cost else 0 end;
  -- v_prior_count is still read above; it no longer changes the price.
  if v_balance < v_cost then raise exception 'insufficient sparks: need %, have %', v_cost, v_balance; end if;

  if v_cost > 0 then
    update public.profiles set sparks = sparks - v_cost where id = v_user_id
      returning sparks into v_balance;
    insert into public.spark_transactions (user_id, delta, reason, reference, balance_after)
    values (v_user_id, -v_cost, 'analysis', p_source_key, v_balance);
  end if;
  accepted_indices := v_accepted;
  sparks_spent := v_cost;
  sparks_balance := v_balance;
  return next;
end $$;

create function public.record_analysis_job_clips(
  p_job_id uuid, p_run_token uuid, p_clips jsonb,
  p_duration_seconds double precision, p_requested_clips integer,
  p_billed_seconds double precision default null
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
    v_job.source_key, p_clips, p_duration_seconds, p_requested_clips, p_billed_seconds);
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

revoke all on function public.record_analysis_clips(text, jsonb, double precision, integer, double precision) from public, anon;
grant execute on function public.record_analysis_clips(text, jsonb, double precision, integer, double precision) to authenticated;
revoke all on function public.record_analysis_job_clips(uuid, uuid, jsonb, double precision, integer, double precision) from public, anon;
grant execute on function public.record_analysis_job_clips(uuid, uuid, jsonb, double precision, integer, double precision) to authenticated;

notify pgrst, 'reload schema';
commit;
