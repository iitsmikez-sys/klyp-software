-- Keep table grants explicit. Newer local Supabase projects do not grant
-- table access automatically, even when row-level policies are present.
-- service_role is server-only and bypasses RLS; browser roles retain RLS.
begin;

grant select on public.profiles to authenticated;
grant select, insert, delete on public.clips to authenticated;
grant select, insert, delete on public.streams to authenticated;
grant select, update on public.notifications to authenticated;
grant select, insert on public.transcripts to authenticated;

grant all on public.profiles, public.clips, public.streams,
  public.notifications, public.transcripts, public.pending_vod_checks,
  public.clip_archive_jobs, public.clip_editor_drafts,
  public.clip_feedback, public.stripe_events to service_role;

notify pgrst, 'reload schema';
commit;
