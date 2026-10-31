-- Development preparation only. Apply after 030 and before R2 clip writes.
-- Supabase remains authoritative; R2 verification is attested by the worker.
begin;

alter table public.clips
  add column if not exists archive_provider text not null default 'supabase';
alter table public.clips drop constraint if exists clips_archive_provider_check;
alter table public.clips add constraint clips_archive_provider_check
  check (archive_provider in ('supabase', 'r2'));

create table if not exists public.clip_r2_manifest (
  clip_id uuid not null references public.clips(id) on delete cascade,
  name text not null check (name in ('master.mp4', 'proxy.mp4', 'poster.jpg')),
  object_key text not null unique,
  bytes bigint not null check (bytes > 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  verified_at timestamptz not null default now(),
  primary key (clip_id, name)
);
alter table public.clip_r2_manifest enable row level security;
revoke all on public.clip_r2_manifest from public, anon, authenticated;
grant all on public.clip_r2_manifest to service_role;

create table if not exists public.clip_r2_migrations (
  clip_id uuid primary key references public.clips(id) on delete cascade,
  legacy_master_path text not null,
  legacy_proxy_path text not null,
  legacy_poster_path text not null,
  migrated_at timestamptz not null default now()
);
alter table public.clip_r2_migrations enable row level security;
revoke all on public.clip_r2_migrations from public, anon, authenticated;
grant all on public.clip_r2_migrations to service_role;

create or replace function public.prepare_clip_archive() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.archive_status := 'pending';
  new.archive_provider := 'supabase';
  new.master_path := null;
  new.proxy_path := null;
  new.poster_path := null;
  new.archived_at := null;
  new.archive_bytes := null;
  new.archive_error := null;
  return new;
end $$;
revoke all on function public.prepare_clip_archive() from public, anon, authenticated;

create or replace function public.finish_clip_archive_job_r2(p_clip_id uuid, p_manifest jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_job public.clip_archive_jobs%rowtype;
  v_user_id uuid;
  v_item jsonb;
  v_name text;
  v_key text;
  v_sha text;
  v_bytes bigint;
  v_total bigint := 0;
begin
  select * into v_job from public.clip_archive_jobs where clip_id = p_clip_id for update;
  if v_job.clip_id is null then raise exception 'archive job not found'; end if;
  if v_job.status = 'done' then return false; end if;
  if v_job.status <> 'processing' then raise exception 'archive job is not claimed'; end if;
  select user_id into v_user_id from public.clips where id = p_clip_id for update;
  if v_user_id is null or p_manifest is null or jsonb_typeof(p_manifest) <> 'array'
     or jsonb_array_length(p_manifest) <> 3 then
    raise exception 'invalid R2 archive manifest';
  end if;
  delete from public.clip_r2_manifest where clip_id = p_clip_id;
  for v_item in select value from jsonb_array_elements(p_manifest) loop
    v_name := v_item->>'name';
    v_key := v_item->>'key';
    v_sha := v_item->>'sha256';
    if v_name not in ('master.mp4','proxy.mp4','poster.jpg')
       or v_key is distinct from 'clips/' || v_user_id::text || '/' || p_clip_id::text || '/' || v_name
       or v_sha !~ '^[0-9a-f]{64}$'
       or (v_item->>'bytes') !~ '^[1-9][0-9]*$' then
      raise exception 'invalid R2 archive object';
    end if;
    v_bytes := (v_item->>'bytes')::bigint;
    insert into public.clip_r2_manifest(clip_id,name,object_key,bytes,sha256)
      values(p_clip_id,v_name,v_key,v_bytes,v_sha);
    v_total := v_total + v_bytes;
  end loop;
  if (select count(*) from public.clip_r2_manifest where clip_id = p_clip_id) <> 3 then
    raise exception 'R2 archive requires three verified objects';
  end if;
  update public.clips set archive_provider = 'r2',
    master_path = 'clips/' || v_user_id::text || '/' || p_clip_id::text || '/master.mp4',
    proxy_path = 'clips/' || v_user_id::text || '/' || p_clip_id::text || '/proxy.mp4',
    poster_path = 'clips/' || v_user_id::text || '/' || p_clip_id::text || '/poster.jpg',
    archive_status = 'stored', archive_error = null,
    archived_at = now(), archive_bytes = v_total where id = p_clip_id;
  update public.clip_archive_jobs set status = 'done', lease_until = null,
    last_error = null, updated_at = now() where clip_id = p_clip_id;
  return true;
end $$;
revoke all on function public.finish_clip_archive_job_r2(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.finish_clip_archive_job_r2(uuid,jsonb) to service_role;

-- Migration changes only the provider pointer. It never deletes Supabase files.
create or replace function public.mark_clip_migrated_to_r2(p_clip_id uuid, p_manifest jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_clip public.clips%rowtype;
  v_item jsonb;
  v_name text;
  v_key text;
  v_sha text;
  v_bytes bigint;
  v_total bigint := 0;
begin
  select * into v_clip from public.clips where id = p_clip_id for update;
  if v_clip.id is null then raise exception 'clip not found'; end if;
  if v_clip.archive_provider = 'r2' then return false; end if;
  if v_clip.archive_status <> 'stored' or v_clip.master_path is null
     or v_clip.proxy_path is null or v_clip.poster_path is null
     or p_manifest is null or jsonb_typeof(p_manifest) <> 'array'
     or jsonb_array_length(p_manifest) <> 3 then
    raise exception 'clip is not ready for migration';
  end if;
  for v_item in select value from jsonb_array_elements(p_manifest) loop
    v_name := v_item->>'name'; v_key := v_item->>'key';
    v_sha := v_item->>'sha256';
    if v_name not in ('master.mp4','proxy.mp4','poster.jpg')
       or v_key is distinct from 'clips/' || v_clip.user_id::text || '/' || p_clip_id::text || '/' || v_name
       or v_sha !~ '^[0-9a-f]{64}$'
       or (v_item->>'bytes') !~ '^[1-9][0-9]*$' then
      raise exception 'invalid migration manifest';
    end if;
    v_bytes := (v_item->>'bytes')::bigint;
    insert into public.clip_r2_manifest(clip_id,name,object_key,bytes,sha256)
      values(p_clip_id,v_name,v_key,v_bytes,v_sha);
    v_total := v_total + v_bytes;
  end loop;
  insert into public.clip_r2_migrations(clip_id,legacy_master_path,legacy_proxy_path,legacy_poster_path)
    values(p_clip_id,v_clip.master_path,v_clip.proxy_path,v_clip.poster_path);
  update public.clips set archive_provider='r2',
    master_path='clips/' || v_clip.user_id::text || '/' || p_clip_id::text || '/master.mp4',
    proxy_path='clips/' || v_clip.user_id::text || '/' || p_clip_id::text || '/proxy.mp4',
    poster_path='clips/' || v_clip.user_id::text || '/' || p_clip_id::text || '/poster.jpg',
    archive_bytes=v_total where id=p_clip_id;
  return true;
end $$;
revoke all on function public.mark_clip_migrated_to_r2(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.mark_clip_migrated_to_r2(uuid,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
