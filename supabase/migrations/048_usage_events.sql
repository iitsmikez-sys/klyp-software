-- A small log of what people do, so questions like "how many people download a clip?" and "where do people drop
-- off on the way to paying?" can be answered. Each row is one event: who, what, a few details, and when.
--
-- Signed-in people can add events for themselves only. Nobody can read them from the browser: only the server
-- (service role) reads them. Events are not personal content, just names like 'download' or 'upgrade_view'.
--
-- Safe to run more than once.
begin;

create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (name ~ '^[a-z_]{1,40}$'),
  props jsonb not null default '{}'::jsonb check (pg_column_size(props) < 2000),
  created_at timestamptz not null default now()
);

create index if not exists usage_events_name_created_idx on public.usage_events (name, created_at desc);
create index if not exists usage_events_user_created_idx on public.usage_events (user_id, created_at desc);

alter table public.usage_events enable row level security;
drop policy if exists "add own usage events" on public.usage_events;
create policy "add own usage events" on public.usage_events
  for insert to authenticated with check (auth.uid() = user_id);

revoke all on public.usage_events from public, anon, authenticated;
grant insert on public.usage_events to authenticated;
grant all on public.usage_events to service_role;

notify pgrst, 'reload schema';
commit;
