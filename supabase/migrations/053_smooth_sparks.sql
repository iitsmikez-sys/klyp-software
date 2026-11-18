-- Smooth Sparks pricing, and a smaller Free allowance.
--
-- The price of a video is now a line instead of steps: 10 Sparks plus 1 Spark for every 5 minutes (12 an hour), rounded UP to
-- the next multiple of 5. 15 min = 15, 30 min = 20, 1 hour = 25, 2 hours = 35, 4 hours = 60, 8 hours = 110.
-- It must match estimateSparks in lib/sparks.ts exactly: ceil((10 + seconds / 300) / 5) * 5.
--
-- record_analysis_clips is copied from migration 050; the ONLY change is the v_vod_cost line. record_analysis_job_clips
-- (which calls it) does not change. The Free allowance goes from 60 to 40 for new accounts and future 30-day refills;
-- balances people already hold are left alone until their next refill.
--
-- Run this BEFORE the code that charges the new prices goes live (the app shows the new price and the database charges
-- it; if only one has changed, a video can be shown at one price and charged another). Safe to run again.
begin;

create or replace function public.tier_allowance(t text)
returns integer language sql immutable
as $$ select case t when 'pro' then 500 else 40 end $$;

alter table public.profiles alter column sparks set default 40;

create or replace function public.record_analysis_clips(
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

  -- Per-video price with clips included: 10 + 1 per 5 minutes, rounded up to the next 5.
  -- The price follows p_billed_seconds when it is given (a free person clipping a 2 hour part of a longer video, or a Pro person
  -- clipping a chosen part), otherwise the whole length. Clip times are still checked against p_duration_seconds.
  v_billed := coalesce(p_billed_seconds, p_duration_seconds);
  v_vod_cost := (ceil((10 + v_billed / 300.0) / 5.0) * 5)::integer;
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

revoke all on function public.record_analysis_clips(text, jsonb, double precision, integer, double precision) from public, anon;
grant execute on function public.record_analysis_clips(text, jsonb, double precision, integer, double precision) to authenticated;

notify pgrst, 'reload schema';
commit;
