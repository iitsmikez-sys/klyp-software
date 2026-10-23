-- Match the advertised 150-Spark free allowance. Some accounts were created
-- with the old 60-Spark column default even after tier_allowance() became 150.
-- Credit only those accounts, preserving any Sparks they already spent.
-- Run after 012_sparks_ledger.sql.
begin;

create or replace function public.tier_allowance(t text)
returns integer language sql immutable
as $$ select case t when 'pro' then 500 else 150 end $$;

alter table public.profiles alter column sparks set default 150;

create unique index if not exists spark_transactions_free_allowance_correction_idx
  on public.spark_transactions (user_id, reference)
  where reason = 'allowance_correction';

with eligible as (
  select id, sparks as previous_balance
  from public.profiles p
  where p.tier = 'free'
    and exists (
      select 1 from public.spark_transactions t
      where t.user_id = p.id and t.reason = 'opening_balance' and t.delta = 60
    )
    and not exists (
      select 1 from public.spark_transactions t
      where t.user_id = p.id and t.reason = 'allowance_correction'
        and t.reference = 'free_150_launch'
    )
    and p.sparks = (
      select sum(t.delta) from public.spark_transactions t where t.user_id = p.id
    )
  for update of p
), topped_up as (
  update public.profiles p
     set sparks = p.sparks + 90
    from eligible e
   where p.id = e.id
  returning p.id, e.previous_balance
)
insert into public.spark_transactions (user_id, delta, reason, reference, balance_after)
select id, 90, 'allowance_correction', 'free_150_launch', previous_balance + 90
from topped_up;

commit;

