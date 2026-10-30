-- Set the Free allowance for new accounts and future 30-day refills.
-- Existing balances, including any unused Sparks from the prior allowance,
-- are preserved until each account's next normal refill.
begin;

create or replace function public.tier_allowance(t text)
returns integer language sql immutable
as $$ select case t when 'pro' then 500 else 60 end $$;

alter table public.profiles alter column sparks set default 60;

commit;
