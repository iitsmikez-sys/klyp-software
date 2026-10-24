-- Queue every saved clip for durable media archival. Deploy before the archive worker.
begin;

insert into storage.buckets (id, name, public, file_size_limit)
  values ('clip-media', 'clip-media', false, 52428800)
  on conflict (id) do nothing;
update storage.buckets set public = false where id = 'clip-media';

alter table public.clip_archive_jobs
  add column if not exists retry_at timestamptz not null default now(),
  add column if not exists lease_until timestamptz;
create index if not exists clip_archive_jobs_due_idx on public.clip_archive_jobs (retry_at)
  where status in ('pending', 'retry', 'processing');

create or replace function public.prepare_clip_archive() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.master_path is null and new.archive_status = 'none' then
    new.archive_status := 'pending';
  end if;
  return new;
end $$;

create or replace function public.queue_clip_archive() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.archive_status = 'pending' then
    insert into public.clip_archive_jobs (clip_id, status, attempts)
      values (new.id, 'pending', 0) on conflict (clip_id) do nothing;
  end if;
  return null;
end $$;

drop trigger if exists clips_prepare_archive on public.clips;
create trigger clips_prepare_archive before insert on public.clips
  for each row execute function public.prepare_clip_archive();
drop trigger if exists clips_queue_archive on public.clips;
create trigger clips_queue_archive after insert on public.clips
  for each row execute function public.queue_clip_archive();

-- Include old rows; stored and unavailable rows are never queued again.
update public.clips set archive_status = 'pending'
  where archive_status in ('none', 'failed') and master_path is null;
insert into public.clip_archive_jobs (clip_id, status, attempts)
  select id, 'pending', 0 from public.clips where archive_status = 'pending'
  on conflict (clip_id) do update set status = 'pending', attempts = 0,
    retry_at = now(), lease_until = null, updated_at = now();

create or replace function public.claim_clip_archive_job()
returns table(clip_id uuid, user_id uuid, url text, start_seconds double precision,
  end_seconds double precision, attempts integer)
language plpgsql security definer set search_path = public as $$
declare v_clip_id uuid;
begin
  select j.clip_id into v_clip_id from public.clip_archive_jobs j
    join public.clips c on c.id = j.clip_id
    where (j.status in ('pending', 'retry') and j.retry_at <= now())
       or (j.status = 'processing' and j.lease_until < now())
    order by c.created_at desc for update of j skip locked limit 1;
  if v_clip_id is null then return; end if;
  update public.clip_archive_jobs j set status = 'processing', attempts = j.attempts + 1,
    lease_until = now() + interval '90 minutes', updated_at = now()
    where j.clip_id = v_clip_id;
  update public.clips set archive_status = 'processing' where id = v_clip_id;
  return query select c.id, c.user_id, c.url, c.start_seconds, c.end_seconds, j.attempts
    from public.clips c join public.clip_archive_jobs j on j.clip_id = c.id
    where c.id = v_clip_id;
end $$;

create or replace function public.finish_clip_archive_job(
  p_clip_id uuid, p_master text, p_proxy text, p_poster text, p_bytes bigint
) returns boolean language plpgsql security definer set search_path = public as $$
declare v_job public.clip_archive_jobs; v_user_id uuid; v_base text;
begin
  select * into v_job from public.clip_archive_jobs where clip_id = p_clip_id for update;
  if v_job.clip_id is null then raise exception 'archive job not found'; end if;
  if v_job.status = 'done' then return false; end if;
  if v_job.status <> 'processing' then raise exception 'archive job is not claimed'; end if;
  select user_id into v_user_id from public.clips where id = p_clip_id;
  v_base := v_user_id::text || '/' || p_clip_id::text || '/';
  if p_master <> v_base || 'master.mp4' or p_proxy <> v_base || 'proxy.mp4'
    or p_poster <> v_base || 'poster.jpg' or p_bytes is null or p_bytes <= 0 then
    raise exception 'invalid archive result';
  end if;
  update public.clips set master_path = p_master, proxy_path = p_proxy,
    poster_path = p_poster, archive_status = 'stored', archive_error = null,
    archived_at = now(), archive_bytes = p_bytes where id = p_clip_id;
  update public.clip_archive_jobs set status = 'done', lease_until = null,
    last_error = null, updated_at = now() where clip_id = p_clip_id;
  return true;
end $$;

create or replace function public.fail_clip_archive_job(
  p_clip_id uuid, p_error text, p_retry_seconds integer, p_source_gone boolean
) returns text language plpgsql security definer set search_path = public as $$
declare v_job public.clip_archive_jobs; v_status text; v_clip_status text;
begin
  select * into v_job from public.clip_archive_jobs where clip_id = p_clip_id for update;
  if v_job.clip_id is null then raise exception 'archive job not found'; end if;
  if v_job.status = 'done' then return 'done'; end if;
  v_status := case when p_source_gone then 'unavailable'
    when v_job.attempts >= 8 then 'failed' else 'retry' end;
  v_clip_status := case when p_source_gone then 'unavailable' else 'failed' end;
  update public.clips set archive_status = v_clip_status,
    archive_error = left(coalesce(p_error, 'Archiving failed'), 300) where id = p_clip_id;
  update public.clip_archive_jobs set status = v_status, lease_until = null,
    retry_at = now() + make_interval(secs => greatest(0, least(coalesce(p_retry_seconds, 120), 86400))),
    last_error = left(coalesce(p_error, 'Archiving failed'), 300), updated_at = now()
    where clip_id = p_clip_id;
  return v_status;
end $$;

revoke all on function public.claim_clip_archive_job() from public, anon, authenticated;
revoke all on function public.finish_clip_archive_job(uuid, text, text, text, bigint) from public, anon, authenticated;
revoke all on function public.fail_clip_archive_job(uuid, text, integer, boolean) from public, anon, authenticated;
grant execute on function public.claim_clip_archive_job() to service_role;
grant execute on function public.finish_clip_archive_job(uuid, text, text, text, bigint) to service_role;
grant execute on function public.fail_clip_archive_job(uuid, text, integer, boolean) to service_role;
notify pgrst, 'reload schema';
commit;
