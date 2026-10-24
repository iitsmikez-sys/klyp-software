-- The original production clips table has numeric timestamp columns.
-- Keep the RPC's public double-precision result stable by casting them.
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
  return query select c.id, c.user_id, c.url,
    c.start_seconds::double precision, c.end_seconds::double precision, j.attempts
    from public.clips c join public.clip_archive_jobs j on j.clip_id = c.id
    where c.id = v_clip_id;
end $$;

notify pgrst, 'reload schema';
