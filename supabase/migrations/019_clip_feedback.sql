-- Private, per-clip creator signals for ranking future suggestions.
begin;

create table if not exists public.clip_feedback (
  clip_id uuid primary key references public.clips(id) on delete cascade,
  user_id uuid not null,
  clip_type text not null,
  verdict text check (verdict in ('approved', 'rejected')),
  edited_at timestamptz,
  downloaded_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists clip_feedback_user_idx on public.clip_feedback(user_id);
alter table public.clip_feedback enable row level security;
drop policy if exists "read own clip feedback" on public.clip_feedback;
create policy "read own clip feedback" on public.clip_feedback
  for select to authenticated using (auth.uid() = user_id);
revoke all on public.clip_feedback from public, anon, authenticated;
grant select on public.clip_feedback to authenticated;

create or replace function public.record_clip_feedback(p_clip_id uuid, p_signal text)
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_type text;
begin
  if p_signal not in ('approved', 'rejected', 'edited', 'downloaded') or p_signal is null then
    raise exception 'invalid feedback';
  end if;
  if auth.uid() is null then raise exception 'sign in required'; end if;
  select user_id, clip_type into v_user, v_type from public.clips where id = p_clip_id;
  if v_user is null or v_user <> auth.uid() then raise exception 'clip not found'; end if;
  insert into public.clip_feedback (clip_id, user_id, clip_type, verdict, edited_at, downloaded_at)
  values (p_clip_id, v_user, v_type,
    case when p_signal in ('approved','rejected') then p_signal end,
    case when p_signal = 'edited' then now() end,
    case when p_signal = 'downloaded' then now() end)
  on conflict (clip_id) do update set
    verdict = case when p_signal in ('approved','rejected') then p_signal else clip_feedback.verdict end,
    edited_at = case when p_signal = 'edited' then coalesce(clip_feedback.edited_at, now()) else clip_feedback.edited_at end,
    downloaded_at = case when p_signal = 'downloaded' then coalesce(clip_feedback.downloaded_at, now()) else clip_feedback.downloaded_at end,
    updated_at = now();
end $$;
revoke all on function public.record_clip_feedback(uuid,text) from public,anon;
grant execute on function public.record_clip_feedback(uuid,text) to authenticated;

create or replace function public.record_draft_edit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.revision > 1 and new.revision > old.revision then
    insert into public.clip_feedback (clip_id, user_id, clip_type, edited_at)
      select new.clip_id, c.user_id, c.clip_type, now() from public.clips c
      where c.id = new.clip_id
      on conflict (clip_id) do update set edited_at = coalesce(clip_feedback.edited_at, now()), updated_at = now();
  end if;
  return new;
end $$;
drop trigger if exists record_draft_edit on public.clip_editor_drafts;
create trigger record_draft_edit after update on public.clip_editor_drafts
  for each row execute function public.record_draft_edit();
notify pgrst, 'reload schema';
commit;
