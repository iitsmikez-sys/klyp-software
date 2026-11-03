-- Yearly Pro plan ($276 a year). A yearly subscriber is invoiced once a year, but Sparks still refill
-- every month, so this adds (1) the billing interval on the profile and (2) a monthly refill function
-- that grants each month's allowance exactly once. Additive: existing profiles stay 'month'.
begin;

alter table public.profiles
  add column if not exists billing_interval text not null default 'month'
  check (billing_interval in ('month', 'year'));

-- Grants one month's Sparks to a yearly subscriber whose refill date has passed. Returns false (and does
-- nothing) when the profile is not an active-looking yearly Pro on that subscription or is not due yet.
-- The ledger reference is unique per user for 'invoice_grant', so the same month can never be granted
-- twice even if the daily job runs again or two runs overlap (the second raises unique_violation).
create or replace function public.refill_yearly_sparks(
  p_user_id uuid, p_subscription_id text, p_reference text, p_balance integer, p_reset_at timestamptz
) returns boolean language plpgsql security definer set search_path = public as $$
declare p public.profiles; previous_balance integer;
begin
  if p_user_id is null or p_subscription_id is null or p_reference is null or btrim(p_reference) = ''
     or p_balance is null or p_balance < 0 or p_reset_at is null then
    raise exception 'invalid yearly refill';
  end if;
  select * into p from public.profiles where id = p_user_id for update;
  if p.id is null or p.tier <> 'pro' or p.billing_interval <> 'year'
     or p.stripe_subscription_id is distinct from p_subscription_id
     or p.sparks_reset_at > now() then
    return false;
  end if;
  previous_balance := p.sparks;
  update public.profiles set sparks = p_balance, sparks_reset_at = p_reset_at where id = p.id;
  insert into public.spark_transactions (user_id, delta, reason, reference, balance_after)
    values (p.id, p_balance - previous_balance, 'invoice_grant', p_reference, p_balance);
  return true;
end $$;

revoke all on function public.refill_yearly_sparks(uuid, text, text, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.refill_yearly_sparks(uuid, text, text, integer, timestamptz) to service_role;

notify pgrst, 'reload schema';
commit;
