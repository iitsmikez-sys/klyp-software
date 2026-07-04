-- Klyp connected channels — run in the Supabase SQL editor (after 001).
-- Stores the Twitch/YouTube/Kick channels a user connects for the upcoming
-- auto-clipping pipeline. Plain RLS CRUD, no RPCs needed.

create table if not exists public.streams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('twitch', 'youtube', 'kick')),
  channel_url text not null,
  created_at timestamptz not null default now(),
  unique (user_id, channel_url)
);

alter table public.streams enable row level security;

drop policy if exists "read own streams" on public.streams;
create policy "read own streams" on public.streams
  for select using (auth.uid() = user_id);

drop policy if exists "insert own streams" on public.streams;
create policy "insert own streams" on public.streams
  for insert with check (auth.uid() = user_id);

drop policy if exists "delete own streams" on public.streams;
create policy "delete own streams" on public.streams
  for delete using (auth.uid() = user_id);
