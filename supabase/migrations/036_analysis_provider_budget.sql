-- Durable upper-bound reservations. Never refund a reservation after an error:
-- the provider may have accepted a request before the worker lost its response.
begin;

create table if not exists public.analysis_provider_budgets (
  run_id uuid primary key,
  reserved_micro_usd bigint not null default 0 check (reserved_micro_usd between 0 and 3000000),
  updated_at timestamptz not null default now()
);
alter table public.analysis_provider_budgets enable row level security;
revoke all on public.analysis_provider_budgets from anon, authenticated;
grant all on public.analysis_provider_budgets to service_role;

create or replace function public.reserve_analysis_provider_budget(
  p_run_id uuid, p_stage text, p_upper_bound_micro_usd bigint
)
returns bigint language plpgsql security definer set search_path = public
as $$
declare v_total bigint;
begin
  if p_run_id is null or p_stage not in ('transcribe', 'select', 'visual-check')
    or p_upper_bound_micro_usd is null or p_upper_bound_micro_usd < 1
    or p_upper_bound_micro_usd > 3000000 then
    raise exception 'provider cost cannot be bounded';
  end if;
  insert into public.analysis_provider_budgets (run_id) values (p_run_id)
    on conflict (run_id) do nothing;
  select reserved_micro_usd into v_total from public.analysis_provider_budgets
    where run_id = p_run_id for update;
  if v_total + p_upper_bound_micro_usd > 3000000 then
    raise exception 'provider budget exceeded: $3 maximum per analysis run';
  end if;
  update public.analysis_provider_budgets
    set reserved_micro_usd = v_total + p_upper_bound_micro_usd, updated_at = now()
    where run_id = p_run_id;
  return v_total + p_upper_bound_micro_usd;
end $$;
revoke all on function public.reserve_analysis_provider_budget(uuid,text,bigint) from public, anon, authenticated;
grant execute on function public.reserve_analysis_provider_budget(uuid,text,bigint) to service_role;
commit;
