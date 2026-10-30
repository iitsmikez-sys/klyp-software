-- An inserted library row is provisional until every private backup object exists.
-- Keep this guard in the database: clients can choose insert columns themselves.
begin;

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
    order by c.created_at asc, j.clip_id asc for update of j skip locked limit 1;
  if v_clip_id is null then return; end if;
  update public.clip_archive_jobs j set status = 'processing', attempts = j.attempts + 1,
    lease_until = now() + interval '90 minutes', updated_at = now()
    where j.clip_id = v_clip_id;
  update public.clips set archive_status = 'processing' where id = v_clip_id;
  return query select c.id, c.user_id, c.url,
    c.start_seconds::double precision, c.end_seconds::double precision, j.attempts
    from public.clips c join public.clip_archive_jobs j on j.clip_id = c.id
    where c.id = v_clip_id;
end $$;

create or replace function public.prepare_clip_archive() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.archive_status := 'pending';
  new.master_path := null;
  new.proxy_path := null;
  new.poster_path := null;
  new.archived_at := null;
  new.archive_bytes := null;
  new.archive_error := null;
  return new;
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
  if not exists (select 1 from storage.objects where bucket_id = 'clip-media' and name = p_master)
    or not exists (select 1 from storage.objects where bucket_id = 'clip-media' and name = p_proxy)
    or not exists (select 1 from storage.objects where bucket_id = 'clip-media' and name = p_poster) then
    raise exception 'archive objects missing from private storage';
  end if;
  update public.clips set master_path = p_master, proxy_path = p_proxy,
    poster_path = p_poster, archive_status = 'stored', archive_error = null,
    archived_at = now(), archive_bytes = p_bytes where id = p_clip_id;
  update public.clip_archive_jobs set status = 'done', lease_until = null,
    last_error = null, updated_at = now() where clip_id = p_clip_id;
  return true;
end $$;

revoke all on function public.prepare_clip_archive() from public, anon, authenticated;
revoke all on function public.claim_clip_archive_job() from public, anon, authenticated;
revoke all on function public.finish_clip_archive_job(uuid, text, text, text, bigint) from public, anon, authenticated;
grant execute on function public.claim_clip_archive_job() to service_role;
grant execute on function public.finish_clip_archive_job(uuid, text, text, text, bigint) to service_role;
notify pgrst, 'reload schema';
commit;
