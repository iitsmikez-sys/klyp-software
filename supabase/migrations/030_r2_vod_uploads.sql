-- Development preparation only. Do not apply to production without release approval.
-- Durable private R2 upload intents; client users may read only their own rows.
begin;

create table if not exists public.vod_uploads (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  object_key text not null unique,
  remote_upload_id text not null,
  file_name text not null check (char_length(file_name) between 1 and 255),
  expected_bytes bigint not null check (expected_bytes between 1 and 4294967296),
  status text not null default 'uploading' check (status in ('uploading','ready','expired')),
  duration_seconds integer check (duration_seconds between 1 and 36000),
  created_at timestamptz not null default now(),
  session_expires_at timestamptz not null,
  ready_at timestamptz,
  source_expires_at timestamptz,
  check (object_key ~ ('^vod/' || user_id::text || '/' || id::text || '/source\.(mp4|mov|avi|mkv|webm|m4v)$')),
  check (status <> 'ready' or (duration_seconds is not null and ready_at is not null and source_expires_at is not null))
);
create index if not exists vod_uploads_owner_idx on public.vod_uploads (user_id, created_at desc);
create index if not exists vod_uploads_expiry_idx on public.vod_uploads (session_expires_at, source_expires_at);
create index if not exists vod_uploads_active_owner_idx on public.vod_uploads(user_id, session_expires_at)
  where status = 'uploading';

-- Bound unfinished multipart storage per account. The advisory lock makes
-- simultaneous starts obey the limit instead of both passing a stale count.
create or replace function public.limit_open_r2_uploads() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));
  if (select count(*) from public.vod_uploads
      where user_id = new.user_id and status = 'uploading'
        and session_expires_at > now()) >= 2 then
    raise exception 'Too many unfinished VOD uploads';
  end if;
  return new;
end $$;
drop trigger if exists vod_uploads_open_limit on public.vod_uploads;
create trigger vod_uploads_open_limit before insert on public.vod_uploads
  for each row execute function public.limit_open_r2_uploads();
revoke all on function public.limit_open_r2_uploads() from public, anon, authenticated;

alter table public.vod_uploads enable row level security;
revoke all on public.vod_uploads from public, anon, authenticated;
grant select on public.vod_uploads to authenticated;
grant all on public.vod_uploads to service_role;
drop policy if exists "read owned vod uploads" on public.vod_uploads;
create policy "read owned vod uploads" on public.vod_uploads for select to authenticated
  using (user_id = auth.uid());

notify pgrst, 'reload schema';
commit;
