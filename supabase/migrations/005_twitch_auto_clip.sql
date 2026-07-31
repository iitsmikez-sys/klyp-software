-- Klyp Auto-Clipping (Twitch) — run in the Supabase SQL editor (after 001-004).
-- Extends `streams` with real Twitch OAuth/EventSub identity, adds the
-- bounded retry-poll queue for "stream just ended, VOD not published yet",
-- and a plain in-app notifications table for the skip+notify low-Sparks case.

-- ── streams: OAuth-connected channel identity + auto-clip state ──
alter table public.streams
  add column if not exists twitch_user_id text,
  add column if not exists twitch_login text,
  add column if not exists eventsub_subscription_id text,
  add column if not exists last_seen_video_id text,
  add column if not exists auto_clip_enabled boolean not null default true;

-- One Klyp connection per Twitch channel — prevents two Klyp users from both
-- registering EventSub subscriptions (and receiving each other's webhooks)
-- for the same broadcaster.
create unique index if not exists streams_twitch_user_id_key
  on public.streams (twitch_user_id) where twitch_user_id is not null;

-- ── pending_vod_checks: bounded "wait a bit, then check Get Videos" queue ──
-- Populated by the EventSub webhook receiver on stream.offline. Server-only —
-- no end-user policies; the background worker uses the service-role client,
-- which bypasses RLS. RLS is still enabled so anon/authenticated get nothing.
create table if not exists public.pending_vod_checks (
  id uuid primary key default gen_random_uuid(),
  stream_id uuid not null references public.streams(id) on delete cascade,
  check_after timestamptz not null,
  attempts int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.pending_vod_checks enable row level security;

create index if not exists pending_vod_checks_due_idx
  on public.pending_vod_checks (check_after);

-- ── notifications: plain in-app messages (e.g. skip+notify on low Sparks) ──
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  message text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.notifications enable row level security;

drop policy if exists "read own notifications" on public.notifications;
create policy "read own notifications" on public.notifications
  for select using (auth.uid() = user_id);

drop policy if exists "mark own notifications read" on public.notifications;
create policy "mark own notifications read" on public.notifications
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- No insert/delete policy for end users — only the service-role background
-- worker creates notifications.

-- ── Service-role Sparks helpers ──
-- get_profile()/consume_sparks() (001) key off auth.uid(), which is null under
-- the service-role client the background worker uses (no request/session
-- context). These mirror the same lazy-monthly-reset + clamped-deduct logic,
-- parameterized by an explicit user id, and are locked to service_role only —
-- never exposed to anon/authenticated, since they bypass the auth.uid() check
-- entirely.

create or replace function public.admin_get_profile(target_user uuid)
returns public.profiles
language plpgsql security definer set search_path = public
as $$
declare p public.profiles;
begin
  insert into public.profiles (id) values (target_user) on conflict do nothing;
  update public.profiles
     set sparks = tier_allowance(tier),
         sparks_reset_at = now() + interval '30 days'
   where id = target_user and sparks_reset_at <= now();
  select * into p from public.profiles where id = target_user;
  return p;
end $$;

revoke all on function public.admin_get_profile(uuid) from public, anon, authenticated;
grant execute on function public.admin_get_profile(uuid) to service_role;

create or replace function public.admin_consume_sparks(target_user uuid, amount integer)
returns integer
language plpgsql security definer set search_path = public
as $$
declare remaining integer;
begin
  if amount is null or amount < 0 then
    raise exception 'invalid amount';
  end if;
  update public.profiles
     set sparks = greatest(0, sparks - amount)
   where id = target_user
   returning sparks into remaining;
  if remaining is null then
    raise exception 'profile not found';
  end if;
  return remaining;
end $$;

revoke all on function public.admin_consume_sparks(uuid, integer) from public, anon, authenticated;
grant execute on function public.admin_consume_sparks(uuid, integer) to service_role;
