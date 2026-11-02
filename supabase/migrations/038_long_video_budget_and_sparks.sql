-- Pro videos longer than about 6.3 hours (up to 8 hours) cost more to process than the standard
-- $3 per-run provider budget allows. Two changes, both only for those long videos:
--   1. A run may carry its own provider budget, fixed when its first reservation is made:
--      $3.00 by default (unchanged), at most $4.50 (4500000 micro-USD) for a long full-transcript run.
--   2. The Sparks charge adds 20 per started hour beyond 6 hours (7h = 70, 8h = 90 before clips).
-- Everything at or under 6 hours is charged exactly as before. Apply this BEFORE deploying the code
-- that raises the Pro length limit to 8 hours.
begin;

alter table public.analysis_provider_budgets
  add column if not exists limit_micro_usd bigint not null default 3000000;
alter table public.analysis_provider_budgets
  drop constraint if exists analysis_provider_budgets_reserved_micro_usd_check;
alter table public.analysis_provider_budgets
  drop constraint if exists analysis_provider_budgets_limit_micro_usd_check;
alter table public.analysis_provider_budgets
  add constraint analysis_provider_budgets_limit_micro_usd_check
  check (limit_micro_usd between 3000000 and 4500000);
alter table public.analysis_provider_budgets
  add constraint analysis_provider_budgets_reserved_micro_usd_check
  check (reserved_micro_usd between 0 and 4500000 and reserved_micro_usd <= limit_micro_usd);

-- Replace the three-argument function (a second overload would make named calls ambiguous).
drop function if exists public.reserve_analysis_provider_budget(uuid, text, bigint);
create function public.reserve_analysis_provider_budget(
  p_run_id uuid, p_stage text, p_upper_bound_micro_usd bigint,
  p_limit_micro_usd bigint default null
)
returns bigint language plpgsql security definer set search_path = public
as $$
declare v_total bigint; v_limit bigint;
begin
  if p_run_id is null or p_stage not in ('transcribe', 'select', 'visual-check')
    or p_upper_bound_micro_usd is null or p_upper_bound_micro_usd < 1
    or p_upper_bound_micro_usd > 4500000
    or (p_limit_micro_usd is not null and (p_limit_micro_usd < 3000000 or p_limit_micro_usd > 4500000)) then
    raise exception 'provider cost cannot be bounded';
  end if;
  -- The limit is fixed by the run's first reservation; later calls cannot raise it.
  insert into public.analysis_provider_budgets (run_id, limit_micro_usd)
    values (p_run_id, coalesce(p_limit_micro_usd, 3000000))
    on conflict (run_id) do nothing;
  select reserved_micro_usd, limit_micro_usd into v_total, v_limit from public.analysis_provider_budgets
    where run_id = p_run_id for update;
  if v_total + p_upper_bound_micro_usd > v_limit then
    raise exception 'provider budget exceeded: $% maximum per analysis run', trim(to_char(v_limit / 1000000.0, 'FM990.00'));
  end if;
  update public.analysis_provider_budgets
    set reserved_micro_usd = v_total + p_upper_bound_micro_usd, updated_at = now()
    where run_id = p_run_id;
  return v_total + p_upper_bound_micro_usd;
end $$;
revoke all on function public.reserve_analysis_provider_budget(uuid, text, bigint, bigint) from public, anon, authenticated;
grant execute on function public.reserve_analysis_provider_budget(uuid, text, bigint, bigint) to service_role;

-- Same function as migration 035 except v_vod_cost, which now adds 20 Sparks per started hour over 6.
create or replace function public.record_analysis_clips(
  p_source_key text, p_clips jsonb, p_duration_seconds double precision,
  p_requested_clips integer
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
  v_clip_cost integer;
  v_vod_cost integer;
  v_cost integer;
  v_prior_count integer;
begin
  if v_user_id is null then raise exception 'not authenticated'; end if;
  if p_source_key is null or p_source_key !~ '^(youtube:[A-Za-z0-9_-]{11}|twitch:[0-9]+|upload:[A-Za-z0-9_-]{1,100})$'
    or p_clips is null or jsonb_typeof(p_clips) <> 'array'
    or jsonb_array_length(p_clips) > 20
    or p_duration_seconds is null or p_duration_seconds <= 0 or p_duration_seconds > 604800
    or p_requested_clips not in (1, 2, 3, 5, 7, 10, 12, 20)
    or jsonb_array_length(p_clips) > p_requested_clips then
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
    end if;
  end loop;

  v_clip_cost := case p_requested_clips
    when 1 then 4 when 2 then 7 when 3 then 10 when 5 then 20 when 7 then 30
    when 10 then 40 when 12 then 50 else 80 end;
  v_vod_cost := case when p_duration_seconds < 1800 then 10
    when p_duration_seconds < 3600 then 20
    when p_duration_seconds < 7200 then 35
    when p_duration_seconds <= 21600 then 50
    else 50 + 20 * ceil((p_duration_seconds - 21600) / 3600.0)::integer end;
  -- An exhausted repeat has no new result to sell. A first analysis with no
  -- quality clips still incurs the disclosed base VOD analysis cost.
  v_cost := case when cardinality(v_accepted) = 0 and v_prior_count > 0 then 0
    else v_vod_cost + floor(v_clip_cost::numeric * cardinality(v_accepted) / p_requested_clips + 0.5)::integer end;
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

notify pgrst, 'reload schema';
commit;
