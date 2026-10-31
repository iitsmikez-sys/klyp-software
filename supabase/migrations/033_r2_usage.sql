-- Development only. Measured operation counts, not a provider invoice.
begin;
create table if not exists public.r2_usage_events (
  id uuid primary key default gen_random_uuid(),
  event_key text unique,
  user_id uuid,
  object_key text not null,
  operation text not null check (operation in
    ('vod_upload','archive_write','archive_verify_read','media_read','media_delete','multipart_abort')),
  bytes bigint not null default 0 check (bytes >= 0),
  request_count integer not null default 1 check (request_count between 1 and 10000),
  created_at timestamptz not null default now()
);
create index if not exists r2_usage_created_idx on public.r2_usage_events(created_at);
create index if not exists r2_usage_user_idx on public.r2_usage_events(user_id,created_at);
alter table public.r2_usage_events enable row level security;
revoke all on public.r2_usage_events from public, anon, authenticated;
grant all on public.r2_usage_events to service_role;
notify pgrst, 'reload schema';
commit;
