-- Development only. Requires 030 and 031. No existing clip receives an expiry.
begin;

alter table public.clips add column if not exists media_expires_at timestamptz;
alter table public.clips drop constraint if exists clips_archive_status_check;
alter table public.clips add constraint clips_archive_status_check
  check (archive_status in ('none','pending','processing','stored','failed','unavailable','expired'));
create index if not exists clips_r2_expiry_idx on public.clips(media_expires_at)
  where archive_provider = 'r2' and archive_status = 'stored' and media_expires_at is not null;

-- Only newly confirmed R2 backups get a clock. Migrated old clips remain
-- grandfathered because their status was already 'stored' before migration.
create or replace function public.set_new_r2_clip_expiry() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_tier text;
begin
  if new.archive_provider = 'r2' and new.archive_status = 'stored'
     and old.archive_status is distinct from 'stored' and new.media_expires_at is null then
    select tier into v_tier from public.profiles where id = new.user_id;
    new.media_expires_at := now() + case when v_tier = 'pro'
      then interval '30 days' else interval '5 days' end;
  end if;
  return new;
end $$;
drop trigger if exists clips_new_r2_expiry on public.clips;
create trigger clips_new_r2_expiry before update of archive_status on public.clips
  for each row execute function public.set_new_r2_clip_expiry();
revoke all on function public.set_new_r2_clip_expiry() from public, anon, authenticated;

-- An upgrade extends the promised date; a downgrade never shortens it.
create or replace function public.extend_r2_clip_expiry_on_upgrade() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.tier = 'free' and new.tier = 'pro' then
    update public.clips set media_expires_at = greatest(media_expires_at, now() + interval '30 days')
      where user_id = new.id and archive_provider = 'r2'
        and archive_status = 'stored' and media_expires_at is not null;
  end if;
  return null;
end $$;
drop trigger if exists profiles_extend_r2_clip_expiry on public.profiles;
create trigger profiles_extend_r2_clip_expiry after update of tier on public.profiles
  for each row execute function public.extend_r2_clip_expiry_on_upgrade();
revoke all on function public.extend_r2_clip_expiry_on_upgrade() from public, anon, authenticated;

-- Independent queue survives clip/user row deletion and worker restarts.
create table if not exists public.r2_cleanup_objects (
  id bigint generated always as identity primary key,
  object_key text not null,
  operation text not null check (operation in ('delete','abort')),
  remote_upload_id text,
  not_before timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending','processing','done')),
  attempts integer not null default 0,
  lease_until timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (object_key, operation),
  check ((operation = 'abort') = (remote_upload_id is not null))
);
create index if not exists r2_cleanup_due_idx on public.r2_cleanup_objects(not_before)
  where status <> 'done';
alter table public.r2_cleanup_objects enable row level security;
revoke all on public.r2_cleanup_objects from public, anon, authenticated;
grant all on public.r2_cleanup_objects to service_role;

-- If a user deletes a clip or account, capture object keys before cascades
-- erase the manifests. The worker still waits an hour for in-flight reads.
create or replace function public.queue_deleted_r2_clip() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.archive_provider = 'r2' then
    insert into public.r2_cleanup_objects(object_key,operation,not_before)
      select object_key,'delete',now() + interval '1 hour'
      from public.clip_r2_manifest where clip_id = old.id
      on conflict (object_key,operation) do nothing;
  end if;
  return old;
end $$;
drop trigger if exists clips_queue_deleted_r2 on public.clips;
create trigger clips_queue_deleted_r2 before delete on public.clips
  for each row execute function public.queue_deleted_r2_clip();

create or replace function public.queue_deleted_r2_vod() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.r2_cleanup_objects(object_key,operation,remote_upload_id,not_before)
    values(old.object_key,case when old.status = 'uploading' then 'abort' else 'delete' end,
      case when old.status = 'uploading' then old.remote_upload_id else null end,
      now() + interval '1 hour')
    on conflict (object_key,operation) do nothing;
  return old;
end $$;
drop trigger if exists vod_uploads_queue_deleted_r2 on public.vod_uploads;
create trigger vod_uploads_queue_deleted_r2 before delete on public.vod_uploads
  for each row execute function public.queue_deleted_r2_vod();
revoke all on function public.queue_deleted_r2_clip() from public, anon, authenticated;
revoke all on function public.queue_deleted_r2_vod() from public, anon, authenticated;

-- Called only by the opted-in worker. No automatic SQL scheduler is installed.
create or replace function public.schedule_expired_r2_media() returns integer
language plpgsql security definer set search_path = public as $$
declare v_count integer := 0; v_row record;
begin
  for v_row in
    select c.id from public.clips c
    where c.archive_provider='r2' and c.archive_status='stored'
      and c.media_expires_at <= now()
      and not exists (select 1 from public.clip_archive_jobs j
        where j.clip_id=c.id and j.status='processing' and j.lease_until > now())
    order by c.media_expires_at for update of c skip locked limit 50
  loop
    insert into public.r2_cleanup_objects(object_key,operation,not_before)
      select object_key,'delete',now() + interval '1 hour'
      from public.clip_r2_manifest where clip_id=v_row.id
      on conflict (object_key,operation) do nothing;
    update public.clips set archive_status='expired' where id=v_row.id;
    v_count := v_count + 1;
  end loop;
  for v_row in
    select u.* from public.vod_uploads u
    where (u.status='uploading' and u.session_expires_at <= now())
       or (u.status='ready' and u.source_expires_at <= now()
         and not exists (select 1 from public.analysis_jobs a
           where a.user_id=u.user_id and a.source_key='upload:' || u.id::text
             and ((a.status='queued' and a.created_at > now()-interval '24 hours')
               or (a.status='running' and a.heartbeat_at > now()-interval '1 hour')))
         and not exists (select 1 from public.clips c
           join public.clip_archive_jobs j on j.clip_id=c.id
           where c.user_id=u.user_id and c.url='upload:' || u.id::text
             and j.status in ('pending','retry','processing')))
    order by u.created_at for update of u skip locked limit 50
  loop
    insert into public.r2_cleanup_objects(object_key,operation,remote_upload_id,not_before)
      values(v_row.object_key,case when v_row.status='uploading' then 'abort' else 'delete' end,
        case when v_row.status='uploading' then v_row.remote_upload_id else null end,
        now() + interval '1 hour')
      on conflict (object_key,operation) do nothing;
    update public.vod_uploads set status='expired' where id=v_row.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

create or replace function public.claim_r2_cleanup_object()
returns table(job_id bigint, object_key text, operation text, remote_upload_id text)
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  select q.id into v_id from public.r2_cleanup_objects q
  where q.not_before <= now() and (q.status='pending'
    or (q.status='processing' and q.lease_until < now()))
  order by q.not_before, q.id for update of q skip locked limit 1;
  if v_id is null then return; end if;
  update public.r2_cleanup_objects q set status='processing', attempts=q.attempts+1,
    lease_until=now()+interval '10 minutes' where q.id=v_id;
  return query select q.id,q.object_key,q.operation,q.remote_upload_id
    from public.r2_cleanup_objects q where q.id=v_id;
end $$;
create or replace function public.finish_r2_cleanup_object(p_job_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.r2_cleanup_objects set status='done',lease_until=null,last_error=null
    where id=p_job_id and status='processing';
end $$;
create or replace function public.fail_r2_cleanup_object(p_job_id bigint,p_error text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.r2_cleanup_objects set status='pending',lease_until=null,
    not_before=now()+interval '1 hour',last_error=left(coalesce(p_error,'delete failed'),300)
    where id=p_job_id and status='processing';
end $$;
revoke all on function public.schedule_expired_r2_media() from public, anon, authenticated;
revoke all on function public.claim_r2_cleanup_object() from public, anon, authenticated;
revoke all on function public.finish_r2_cleanup_object(bigint) from public, anon, authenticated;
revoke all on function public.fail_r2_cleanup_object(bigint,text) from public, anon, authenticated;
grant execute on function public.schedule_expired_r2_media() to service_role;
grant execute on function public.claim_r2_cleanup_object() to service_role;
grant execute on function public.finish_r2_cleanup_object(bigint) to service_role;
grant execute on function public.fail_r2_cleanup_object(bigint,text) to service_role;
notify pgrst, 'reload schema';
commit;
