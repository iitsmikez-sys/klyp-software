-- Klyp Sparks system — run this in the Supabase SQL editor (Dashboard → SQL Editor).
-- Creates the profiles table (tier + Sparks balance), auto-provisions a profile
-- on signup, and exposes two RPCs the app calls with the user's own session:
--   get_profile()          → returns the profile, lazily resetting Sparks monthly
--   consume_sparks(amount) → atomic deduction, clamped at 0, returns new balance

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  tier text not null default 'free' check (tier in ('free', 'pro')),
  sparks integer not null default 60,
  sparks_reset_at timestamptz not null default (now() + interval '30 days'),
  stripe_customer_id text,
  stripe_subscription_id text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select using (auth.uid() = id);
-- No insert/update policies: all writes go through the security-definer RPCs
-- below or the Stripe webhook (service role key bypasses RLS).

-- Auto-create a profile when a user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Monthly Sparks allowance per tier. Keep in sync with lib/sparks.ts.
create or replace function public.tier_allowance(t text)
returns integer language sql immutable
as $$ select case t when 'pro' then 500 else 60 end $$;

-- Returns the caller's profile, refilling Sparks if the monthly reset passed.
-- Also backfills a profile row for users created before this migration.
create or replace function public.get_profile()
returns public.profiles
language plpgsql security definer set search_path = public
as $$
declare p public.profiles;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  insert into public.profiles (id) values (auth.uid()) on conflict do nothing;
  update public.profiles
     set sparks = tier_allowance(tier),
         sparks_reset_at = now() + interval '30 days'
   where id = auth.uid() and sparks_reset_at <= now();
  select * into p from public.profiles where id = auth.uid();
  return p;
end $$;

-- Atomically deduct Sparks (clamped at 0). Returns the remaining balance.
create or replace function public.consume_sparks(amount integer)
returns integer
language plpgsql security definer set search_path = public
as $$
declare remaining integer;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if amount is null or amount < 0 then
    raise exception 'invalid amount';
  end if;
  update public.profiles
     set sparks = greatest(0, sparks - amount)
   where id = auth.uid()
   returning sparks into remaining;
  if remaining is null then
    raise exception 'profile not found';
  end if;
  return remaining;
end $$;
