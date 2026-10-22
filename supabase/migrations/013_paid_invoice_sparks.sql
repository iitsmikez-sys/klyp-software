-- Run after 012_sparks_ledger.sql. Pro Sparks refill only on a paid invoice.
begin;

alter table public.profiles
  add column if not exists last_paid_invoice_period_start timestamptz;
alter table public.profiles
  add column if not exists last_paid_invoice_subscription_id text;
alter table public.profiles
  add column if not exists last_paid_invoice_event_created timestamptz;

-- Free accounts keep their 30-day reset. A Pro renewal must be paid before
-- the next Pro allowance is issued, even if the old reset date has passed.
create or replace function public.get_profile()
returns public.profiles
language plpgsql security definer set search_path = public
as $$
declare
  p public.profiles;
  previous_balance integer;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  insert into public.profiles (id) values (auth.uid()) on conflict do nothing;
  select * into p from public.profiles where id = auth.uid() for update;
  if p.tier <> 'pro' and p.sparks_reset_at <= now() then
    previous_balance := p.sparks;
    update public.profiles
       set sparks = tier_allowance(tier),
           sparks_reset_at = now() + interval '30 days'
     where id = p.id returning * into p;
    insert into public.spark_transactions (user_id, delta, reason, balance_after)
    values (p.id, p.sparks - previous_balance, 'monthly_reset', p.sparks);
  end if;
  return p;
end $$;

create or replace function public.admin_get_profile(target_user uuid)
returns public.profiles
language plpgsql security definer set search_path = public
as $$
declare
  p public.profiles;
  previous_balance integer;
begin
  insert into public.profiles (id) values (target_user) on conflict do nothing;
  select * into p from public.profiles where id = target_user for update;
  if p.tier <> 'pro' and p.sparks_reset_at <= now() then
    previous_balance := p.sparks;
    update public.profiles
       set sparks = tier_allowance(tier),
           sparks_reset_at = now() + interval '30 days'
     where id = p.id returning * into p;
    insert into public.spark_transactions (user_id, delta, reason, balance_after)
    values (p.id, p.sparks - previous_balance, 'monthly_reset', p.sparks);
  end if;
  return p;
end $$;

revoke all on function public.admin_get_profile(uuid) from public, anon, authenticated;
grant execute on function public.admin_get_profile(uuid) to service_role;

-- Use the invoice ID as p_event_id for invoice_grant. Locking the profile and
-- checking the ledger in the same transaction makes a repeat event a no-op.
create or replace function public.grant_tier_sparks(
  p_user_id uuid,
  p_match_customer_id text,
  p_tier text,
  p_balance integer,
  p_reset_at timestamptz,
  p_event_id text,
  p_reason text,
  p_customer_id text,
  p_subscription_id text,
  p_set_subscription boolean
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  profile_id uuid;
  previous_balance integer;
begin
  if p_tier is null or p_tier not in ('free', 'pro')
     or p_balance is null or p_balance < 0 or p_reset_at is null
     or p_event_id is null or btrim(p_event_id) = ''
     or p_reason is null
     or p_reason not in ('checkout_grant', 'invoice_grant', 'subscription_deleted') then
    raise exception 'invalid Sparks grant';
  end if;
  if p_user_id is null and p_match_customer_id is null then
    raise exception 'missing profile match';
  end if;

  select id, sparks into profile_id, previous_balance
    from public.profiles
   where (p_user_id is not null and id = p_user_id)
      or (p_user_id is null and stripe_customer_id = p_match_customer_id)
   for update;
  if profile_id is null then
    raise exception 'profile not found for Sparks grant';
  end if;

  if exists (
    select 1 from public.spark_transactions
     where user_id = profile_id and reference = p_event_id
       and reason in ('checkout_grant', 'invoice_grant', 'subscription_deleted')
  ) then
    return profile_id;
  end if;

  update public.profiles
     set tier = p_tier,
         sparks = p_balance,
         sparks_reset_at = p_reset_at,
         stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
         stripe_subscription_id = case when p_set_subscription then p_subscription_id
                                       else stripe_subscription_id end
   where id = profile_id;
  insert into public.spark_transactions (user_id, delta, reason, reference, balance_after)
    values (profile_id, p_balance - previous_balance, p_reason, p_event_id, p_balance);
  return profile_id;
end $$;

revoke all on function public.grant_tier_sparks(uuid, text, text, integer, timestamptz, text, text, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.grant_tier_sparks(uuid, text, text, integer, timestamptz, text, text, text, text, boolean)
  to service_role;

-- Invoice IDs prevent duplicate delivery from granting twice. The paid
-- service period prevents an older, distinct invoice delivered late from
-- resetting Sparks after a newer billing cycle has already been granted.
create or replace function public.grant_paid_invoice_sparks(
  p_user_id uuid,
  p_match_customer_id text,
  p_invoice_id text,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_customer_id text,
  p_subscription_id text,
  p_paid_event_created timestamptz
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  profile_id uuid;
  last_period timestamptz;
  last_subscription text;
begin
  if p_period_start is null or p_period_end is null
     or p_period_end <= p_period_start or p_paid_event_created is null
     or p_subscription_id is null then
    raise exception 'invalid paid invoice period';
  end if;
  if p_user_id is null and p_match_customer_id is null then
    raise exception 'missing profile match';
  end if;

  select id, last_paid_invoice_period_start, last_paid_invoice_subscription_id
    into profile_id, last_period, last_subscription
    from public.profiles
   where (p_user_id is not null and id = p_user_id)
      or (p_user_id is null and stripe_customer_id = p_match_customer_id)
   for update;
  if profile_id is null then
    raise exception 'profile not found for paid invoice';
  end if;
  if last_period is not null and (
    p_period_start < last_period or
    (p_period_start = last_period and last_subscription = p_subscription_id)
  ) then
    return profile_id;
  end if;

  perform public.grant_tier_sparks(
    p_user_id, p_match_customer_id, 'pro', public.tier_allowance('pro'),
    p_period_end, p_invoice_id, 'invoice_grant', p_customer_id,
    p_subscription_id, true
  );
  update public.profiles
     set last_paid_invoice_period_start = p_period_start,
         last_paid_invoice_subscription_id = p_subscription_id,
         last_paid_invoice_event_created = p_paid_event_created
   where id = profile_id;
  return profile_id;
end $$;

revoke all on function public.grant_paid_invoice_sparks(uuid, text, text, timestamptz, timestamptz, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.grant_paid_invoice_sparks(uuid, text, text, timestamptz, timestamptz, text, text, timestamptz)
  to service_role;

-- A delayed terminal event may race with an invoice that restored Pro. The
-- profile lock and event time check keep that older event from removing paid
-- access. Matching the current subscription also ignores stale old plans.
create or replace function public.downgrade_subscription_if_current(
  p_user_id uuid,
  p_match_customer_id text,
  p_subscription_id text,
  p_terminal_event_created timestamptz
)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  profile_id uuid;
  paid_event_created timestamptz;
begin
  if p_subscription_id is null or p_terminal_event_created is null then
    raise exception 'invalid terminal subscription event';
  end if;
  if p_user_id is null and p_match_customer_id is null then
    raise exception 'missing profile match';
  end if;
  select id, last_paid_invoice_event_created into profile_id, paid_event_created
    from public.profiles
   where stripe_subscription_id = p_subscription_id
     and ((p_user_id is not null and id = p_user_id)
       or (p_user_id is null and stripe_customer_id = p_match_customer_id))
   for update;
  if profile_id is null or
     (paid_event_created is not null and p_terminal_event_created < paid_event_created) then
    return false;
  end if;
  update public.profiles
     set tier = 'free', stripe_subscription_id = null
   where id = profile_id;
  return true;
end $$;

revoke all on function public.downgrade_subscription_if_current(uuid, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.downgrade_subscription_if_current(uuid, text, text, timestamptz)
  to service_role;

-- Called only after a fresh Stripe lookup says the same subscription is
-- active. A payment may have raced a terminal event at the same second;
-- restore paid access without issuing another Sparks grant.
create or replace function public.restore_paid_subscription_if_current(
  p_user_id uuid,
  p_match_customer_id text,
  p_subscription_id text,
  p_terminal_event_created timestamptz
)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  profile_id uuid;
begin
  if p_subscription_id is null or p_terminal_event_created is null
     or (p_user_id is null and p_match_customer_id is null) then
    raise exception 'invalid paid subscription restore';
  end if;
  select id into profile_id from public.profiles
   where last_paid_invoice_subscription_id = p_subscription_id
     and last_paid_invoice_event_created >= p_terminal_event_created
     and (stripe_subscription_id is null or stripe_subscription_id = p_subscription_id)
     and ((p_user_id is not null and id = p_user_id)
       or (p_user_id is null and stripe_customer_id = p_match_customer_id))
   for update;
  if profile_id is null then
    return false;
  end if;
  update public.profiles
     set tier = 'pro', stripe_subscription_id = p_subscription_id
   where id = profile_id;
  return true;
end $$;

revoke all on function public.restore_paid_subscription_if_current(uuid, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.restore_paid_subscription_if_current(uuid, text, text, timestamptz)
  to service_role;

notify pgrst, 'reload schema';
commit;
