-- Run manually in the Supabase SQL editor after 011_free_allowance.sql.
-- This migration is intentionally not applied by the app or a CLI.
begin;

create table if not exists public.spark_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  delta integer not null,
  reason text not null check (length(btrim(reason)) > 0),
  reference text,
  balance_after integer not null check (balance_after >= 0),
  created_at timestamptz not null default now()
);

create index if not exists spark_transactions_user_created_idx
  on public.spark_transactions (user_id, created_at desc);

-- A Stripe event must not produce two ledger rows for the same user.
create unique index if not exists spark_transactions_user_reference_idx
  on public.spark_transactions (user_id, reference)
  where reason in ('checkout_grant', 'invoice_grant', 'subscription_deleted');

alter table public.spark_transactions enable row level security;

drop policy if exists "read own spark transactions" on public.spark_transactions;
create policy "read own spark transactions" on public.spark_transactions
  for select using (auth.uid() = user_id);
-- Only security-definer functions and the service role may write ledger rows.
revoke all on public.spark_transactions from public, anon, authenticated;
grant select on public.spark_transactions to authenticated;
grant all on public.spark_transactions to service_role;

-- Establish the starting balance; older transactions cannot be reconstructed.
insert into public.spark_transactions (user_id, delta, reason, balance_after)
select id, sparks, 'opening_balance', sparks from public.profiles p
where not exists (
  select 1 from public.spark_transactions t where t.user_id = p.id
);

-- Profiles created after this migration need an opening entry too.
create or replace function public.record_initial_sparks()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.spark_transactions (user_id, delta, reason, balance_after)
  values (new.id, new.sparks, 'opening_balance', new.sparks);
  return new;
end $$;

drop trigger if exists on_profile_created_record_sparks on public.profiles;
create trigger on_profile_created_record_sparks
  after insert on public.profiles
  for each row execute function public.record_initial_sparks();

-- The lazy 30-day refill is also a balance change. Keep it in the ledger.
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
  if p.sparks_reset_at <= now() then
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
  if p.sparks_reset_at <= now() then
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

-- Replace the old one-argument RPC so callers can optionally attach the VOD
-- or upload reference. The original amount-only call remains valid.
drop function if exists public.consume_sparks(integer);
create function public.consume_sparks(amount integer, p_reference text default null)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  remaining integer;
  user_id uuid := auth.uid();
begin
  if user_id is null then
    raise exception 'not authenticated';
  end if;
  if amount is null or amount < 0 then
    raise exception 'invalid amount';
  end if;
  select sparks into remaining from public.profiles where id = user_id for update;
  if remaining is null then
    raise exception 'profile not found';
  end if;
  if remaining < amount then
    raise exception 'insufficient sparks: need %, have %', amount, remaining;
  end if;

  update public.profiles set sparks = sparks - amount where id = user_id
    returning sparks into remaining;
  if amount > 0 then
    insert into public.spark_transactions (user_id, delta, reason, reference, balance_after)
    values (user_id, -amount, 'analysis', p_reference, remaining);
  end if;
  return remaining;
end $$;

revoke all on function public.consume_sparks(integer, text) from public, anon;
grant execute on function public.consume_sparks(integer, text) to authenticated;

drop function if exists public.admin_consume_sparks(uuid, integer);
create function public.admin_consume_sparks(target_user uuid, amount integer, p_reference text default null)
returns integer
language plpgsql security definer set search_path = public
as $$
declare remaining integer;
begin
  if amount is null or amount < 0 then
    raise exception 'invalid amount';
  end if;
  select sparks into remaining from public.profiles where id = target_user for update;
  if remaining is null then
    raise exception 'profile not found';
  end if;
  if remaining < amount then
    raise exception 'insufficient sparks: need %, have %', amount, remaining;
  end if;

  update public.profiles set sparks = sparks - amount where id = target_user
    returning sparks into remaining;
  if amount > 0 then
    insert into public.spark_transactions (user_id, delta, reason, reference, balance_after)
    values (target_user, -amount, 'auto_clip', p_reference, remaining);
  end if;
  return remaining;
end $$;

revoke all on function public.admin_consume_sparks(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.admin_consume_sparks(uuid, integer, text) to service_role;

-- Preserve the dev adjustment tool without leaving a direct, unlogged write.
create or replace function public.admin_adjust_sparks(target_user uuid, amount integer, p_reference text default null)
returns integer
language plpgsql security definer set search_path = public
as $$
declare remaining integer;
begin
  if amount is null or amount = 0 then
    raise exception 'invalid amount';
  end if;
  select sparks into remaining from public.profiles where id = target_user for update;
  if remaining is null then
    raise exception 'profile not found';
  end if;
  if remaining + amount < 0 then
    raise exception 'insufficient sparks: adjustment %, have %', amount, remaining;
  end if;
  update public.profiles set sparks = sparks + amount where id = target_user
    returning sparks into remaining;
  insert into public.spark_transactions (user_id, delta, reason, reference, balance_after)
  values (target_user, amount, 'manual_adjustment', p_reference, remaining);
  return remaining;
end $$;

revoke all on function public.admin_adjust_sparks(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.admin_adjust_sparks(uuid, integer, text) to service_role;

-- Called only by the verified Stripe webhook. Row lock, balance replacement,
-- profile metadata, and ledger row are one PostgreSQL transaction.
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

notify pgrst, 'reload schema';
commit;
