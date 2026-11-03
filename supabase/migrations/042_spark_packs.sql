-- Spark packs: one-time purchases of extra Sparks (100 for $8, 250 for $18, 500 for $33).
--
-- Bought Sparks are part of profiles.sparks (so every existing check and charge keeps working) and are
-- tracked in profiles.pack_sparks, the portion of the balance that
--   * is spent LAST (monthly Sparks go first), and
--   * survives the monthly reset or refill (a reset gives allowance + pack_sparks, never wiping packs).
-- Invariant: 0 <= pack_sparks <= sparks. Additive: existing profiles start at 0.
begin;

alter table public.profiles
  add column if not exists pack_sparks integer not null default 0 check (pack_sparks >= 0);

-- Whatever spends Sparks (the analysis charge, auto-clip, exports) only lowers profiles.sparks. This
-- trigger then takes the spend from the monthly part first: bought Sparks shrink only once the
-- balance falls below them.
create or replace function public.keep_pack_sparks_within_balance()
returns trigger language plpgsql as $$
begin
  if new.sparks < old.sparks then
    new.pack_sparks := least(new.pack_sparks, greatest(new.sparks, 0));
  end if;
  return new;
end $$;

drop trigger if exists profiles_keep_pack_sparks on public.profiles;
create trigger profiles_keep_pack_sparks
  before update of sparks on public.profiles
  for each row execute function public.keep_pack_sparks_within_balance();

-- Free monthly reset: the allowance PLUS any bought Sparks (same as migration 025 otherwise).
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
  if p.tier = 'free' and p.sparks_reset_at <= now() then
    previous_balance := p.sparks;
    update public.profiles
       set sparks = tier_allowance(tier) + pack_sparks,
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
  if p.tier = 'free' and p.sparks_reset_at <= now() then
    previous_balance := p.sparks;
    update public.profiles
       set sparks = tier_allowance(tier) + pack_sparks,
           sparks_reset_at = now() + interval '30 days'
     where id = p.id returning * into p;
    insert into public.spark_transactions (user_id, delta, reason, balance_after)
    values (p.id, p.sparks - previous_balance, 'monthly_reset', p.sparks);
  end if;
  return p;
end $$;

revoke all on function public.admin_get_profile(uuid) from public, anon, authenticated;
grant execute on function public.admin_get_profile(uuid) to service_role;

-- A paid invoice grants the plan's allowance (migration 012) PLUS the bought Sparks the person holds.
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
  held_packs integer;
  new_balance integer;
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

  select id, sparks, pack_sparks into profile_id, previous_balance, held_packs
    from public.profiles
   where (p_user_id is not null and id = p_user_id)
      or (p_user_id is null and stripe_customer_id = p_match_customer_id)
   for update;
  if profile_id is null then
    raise exception 'profile not found for Sparks grant';
  end if;
  new_balance := p_balance + held_packs;

  update public.profiles
     set tier = p_tier,
         sparks = new_balance,
         sparks_reset_at = p_reset_at,
         stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
         stripe_subscription_id = case when p_set_subscription then p_subscription_id
                                       else stripe_subscription_id end
   where id = profile_id;
  insert into public.spark_transactions (user_id, delta, reason, reference, balance_after)
    values (profile_id, new_balance - previous_balance, p_reason, p_event_id, new_balance);
  return profile_id;
end $$;

revoke all on function public.grant_tier_sparks(uuid, text, text, integer, timestamptz, text, text, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.grant_tier_sparks(uuid, text, text, integer, timestamptz, text, text, text, text, boolean)
  to service_role;

-- A yearly subscriber's monthly top-up (migration 041), keeping bought Sparks.
create or replace function public.refill_yearly_sparks(
  p_user_id uuid, p_subscription_id text, p_reference text, p_balance integer, p_reset_at timestamptz
) returns boolean language plpgsql security definer set search_path = public as $$
declare p public.profiles; previous_balance integer; new_balance integer;
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
  new_balance := p_balance + p.pack_sparks;
  update public.profiles set sparks = new_balance, sparks_reset_at = p_reset_at where id = p.id;
  insert into public.spark_transactions (user_id, delta, reason, reference, balance_after)
    values (p.id, new_balance - previous_balance, 'invoice_grant', p_reference, new_balance);
  return true;
end $$;

revoke all on function public.refill_yearly_sparks(uuid, text, text, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.refill_yearly_sparks(uuid, text, text, integer, timestamptz) to service_role;

-- A paid Spark pack. The Stripe checkout session id is the reference; the unique index below makes a
-- repeated delivery (a retried webhook, the repair sync) raise unique_violation instead of granting twice.
create unique index if not exists spark_transactions_pack_reference_idx
  on public.spark_transactions (user_id, reference)
  where reason = 'pack_purchase';

create or replace function public.add_pack_sparks(p_user_id uuid, p_sparks integer, p_reference text)
returns boolean language plpgsql security definer set search_path = public as $$
declare p public.profiles; new_balance integer;
begin
  if p_user_id is null or p_reference is null or btrim(p_reference) = ''
     or p_sparks is null or p_sparks < 1 or p_sparks > 5000 then
    raise exception 'invalid Spark pack';
  end if;
  select * into p from public.profiles where id = p_user_id for update;
  if p.id is null then raise exception 'profile not found for Spark pack'; end if;
  new_balance := p.sparks + p_sparks;
  -- Ledger first: a duplicate reference fails here, before any balance changes.
  insert into public.spark_transactions (user_id, delta, reason, reference, balance_after)
    values (p.id, p_sparks, 'pack_purchase', p_reference, new_balance);
  update public.profiles set sparks = new_balance, pack_sparks = p.pack_sparks + p_sparks where id = p.id;
  return true;
end $$;

revoke all on function public.add_pack_sparks(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.add_pack_sparks(uuid, integer, text) to service_role;

notify pgrst, 'reload schema';
commit;
