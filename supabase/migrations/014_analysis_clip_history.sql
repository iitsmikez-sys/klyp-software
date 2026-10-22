-- Apply after 012_sparks_ledger.sql. The processing route requires this RPC;
-- apply the migration before deploying the matching processing service.
begin;

create table if not exists public.analysis_clip_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  source_key text not null,
  start_seconds double precision not null,
  end_seconds double precision not null,
  created_at timestamptz not null default now()
);
create index if not exists analysis_clip_history_lookup_idx
  on public.analysis_clip_history (user_id, source_key);
alter table public.analysis_clip_history enable row level security;
drop policy if exists "read own analysis clip history" on public.analysis_clip_history;
create policy "read own analysis clip history" on public.analysis_clip_history
  for select to authenticated using (auth.uid() = user_id);
revoke all on public.analysis_clip_history from public, anon, authenticated;
grant select on public.analysis_clip_history to authenticated;
grant all on public.analysis_clip_history to service_role;

-- Saved clips from earlier releases are known delivered moments. Unkept old
-- results cannot be reconstructed, so history starts for them at deployment.
insert into public.analysis_clip_history (user_id, source_key, start_seconds, end_seconds, created_at)
select c.user_id,
  case
    when c.url ~* 'twitch\.tv/videos/[0-9]+' then 'twitch:' || substring(c.url from '/videos/([0-9]+)')
    when c.url ~* 'youtu\.be/[A-Za-z0-9_-]{11}' then 'youtube:' || substring(c.url from 'youtu\.be/([A-Za-z0-9_-]{11})')
    when c.url ~* 'youtube\.com/watch\?' then 'youtube:' || substring(c.url from '[?&]v=([A-Za-z0-9_-]{11})')
    when c.url ~ '^upload:[A-Za-z0-9_-]+$' then c.url
  end,
  c.start_seconds, c.end_seconds, c.created_at
from public.clips c
where c.end_seconds > c.start_seconds
  and (c.url ~* 'twitch\.tv/videos/[0-9]+'
    or c.url ~* 'youtu\.be/[A-Za-z0-9_-]{11}'
    or c.url ~* 'youtube\.com/watch\?[^#]*[?&]v=[A-Za-z0-9_-]{11}'
    or c.url ~ '^upload:[A-Za-z0-9_-]+$');

-- Locking the profile row serializes simultaneous analyses by this user. The
-- second request sees the first request's windows and cannot charge for them.
create function public.record_analysis_clips(
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
    or p_requested_clips not in (3, 5, 7, 10, 12, 20)
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
    when 3 then 10 when 5 then 20 when 7 then 30
    when 10 then 40 when 12 then 50 else 80 end;
  v_vod_cost := case when p_duration_seconds < 1800 then 10
    when p_duration_seconds < 3600 then 20
    when p_duration_seconds < 7200 then 35 else 50 end;
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

revoke all on function public.record_analysis_clips(text, jsonb, double precision, integer) from public, anon;
grant execute on function public.record_analysis_clips(text, jsonb, double precision, integer) to authenticated;
notify pgrst, 'reload schema';
commit;
