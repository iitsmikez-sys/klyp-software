-- One private, versioned editing draft per owned clip. The browser reads under
-- RLS; writes go through compare-and-swap so another device cannot be erased.
begin;

create table if not exists public.clip_editor_drafts (
  clip_id uuid primary key references public.clips(id) on delete cascade,
  user_id uuid not null,
  draft jsonb not null,
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(draft) = 'object'),
  check (octet_length(draft::text) <= 65536)
);
create index if not exists clip_editor_drafts_user_idx
  on public.clip_editor_drafts(user_id);
alter table public.clip_editor_drafts enable row level security;

drop policy if exists "read own editor draft" on public.clip_editor_drafts;
create policy "read own editor draft" on public.clip_editor_drafts
  for select to authenticated using (auth.uid() = user_id);
revoke all on public.clip_editor_drafts from public, anon, authenticated;
grant select on public.clip_editor_drafts to authenticated;

create or replace function public.save_clip_editor_draft(
  p_clip_id uuid, p_base_revision integer, p_draft jsonb
) returns integer language plpgsql security definer set search_path = public as $$
declare v_user_id uuid; v_revision integer;
begin
  if auth.uid() is null then raise exception 'sign in required'; end if;
  select user_id into v_user_id from public.clips where id = p_clip_id;
  if v_user_id is null or v_user_id <> auth.uid() then raise exception 'clip not found'; end if;
  if p_draft is null or jsonb_typeof(p_draft) <> 'object' or
      p_draft->>'version' <> '1' then raise exception 'invalid draft'; end if;
  if octet_length(p_draft::text) > 65536 then raise exception 'draft too large'; end if;
  if p_base_revision = 0 then
    insert into public.clip_editor_drafts (clip_id, user_id, draft)
      values (p_clip_id, v_user_id, p_draft)
      on conflict (clip_id) do nothing returning revision into v_revision;
  elsif p_base_revision > 0 then
    update public.clip_editor_drafts set draft = p_draft,
      revision = revision + 1, updated_at = now()
      where clip_id = p_clip_id and user_id = v_user_id
        and revision = p_base_revision returning revision into v_revision;
  end if;
  if v_revision is null then raise exception 'draft conflict'; end if;
  return v_revision;
end $$;

revoke all on function public.save_clip_editor_draft(uuid, integer, jsonb)
  from public, anon;
grant execute on function public.save_clip_editor_draft(uuid, integer, jsonb)
  to authenticated;
notify pgrst, 'reload schema';
commit;
