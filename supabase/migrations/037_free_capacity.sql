-- Run manually in the Supabase SQL editor (after 036_analysis_provider_budget.sql).
-- This migration is intentionally not applied by the app or a CLI.
--
-- Free-plan daily capacity breaker: remember, per analysis job, which plan started it and
-- the estimated provider cost, so the server can cap the day's total Free long-run spend
-- (KLYP_FREE_DAILY_LIMIT_USD, lib/free-capacity.ts). Additive and nullable: no backfill, no
-- existing row or function changes. Until this is applied the breaker simply stays off
-- (the app treats a missing column as "unavailable" and carries on).
begin;

alter table public.analysis_jobs
  add column if not exists plan_at_start text check (plan_at_start in ('free', 'pro')),
  add column if not exists est_cost_micro_usd bigint check (est_cost_micro_usd >= 0);

-- The breaker sums today's Free jobs; keep that lookup cheap.
create index if not exists analysis_jobs_free_cost_idx
  on public.analysis_jobs (created_at) where plan_at_start = 'free';

notify pgrst, 'reload schema';
commit;
