-- Documents and (re)asserts ownership on the clips table — run in the Supabase
-- SQL editor (after 001-003). The clips table itself and its RLS policies were
-- originally set up directly in the dashboard and were never tracked in a
-- migration file; this makes that state explicit and reproducible, and folds
-- in migration 003's hooks/words columns (confirmed NOT applied to the live
-- table as of this writing — every saved clip has been silently missing them).
--
-- Safe to run against the existing production table: `create table if not
-- exists` no-ops since it already exists, `add column if not exists` only
-- adds what's missing, and the policies are dropped-and-recreated idempotently
-- (verified live: an anon/unauthenticated client already gets 0 rows back —
-- this migration documents that guarantee in version control, it doesn't
-- change current behavior).

create table if not exists public.clips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  url text not null,
  title text not null,
  clip_type text not null,
  viral_score integer not null,
  caption text,
  reason text,
  start_seconds double precision not null,
  end_seconds double precision not null,
  created_at timestamptz not null default now()
);

-- Migration 003, folded in — confirmed missing from the live table.
alter table public.clips
  add column if not exists hooks jsonb,
  add column if not exists words jsonb;

alter table public.clips enable row level security;

drop policy if exists "read own clips" on public.clips;
create policy "read own clips" on public.clips
  for select using (auth.uid() = user_id);

drop policy if exists "insert own clips" on public.clips;
create policy "insert own clips" on public.clips
  for insert with check (auth.uid() = user_id);

drop policy if exists "delete own clips" on public.clips;
create policy "delete own clips" on public.clips
  for delete using (auth.uid() = user_id);
