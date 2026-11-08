-- Messages people send from the "Something wrong?" button on the dashboard.
--
--  * A signed-in person can add messages for themselves only (and at most 10 an hour); nobody can read them from
--    the browser. Only the server reads them.
--  * emailed_at marks a message as already emailed to the owner, so each one is emailed once.
--
-- Safe to run more than once.
begin;

create table if not exists public.feedback_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (reason in ('clips', 'broke', 'billing', 'idea')),
  message text not null default '' check (char_length(message) <= 2000),
  page text check (page is null or char_length(page) <= 200),
  user_agent text check (user_agent is null or char_length(user_agent) <= 300),
  emailed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists feedback_messages_unsent_idx on public.feedback_messages (created_at) where emailed_at is null;
create index if not exists feedback_messages_user_created_idx on public.feedback_messages (user_id, created_at desc);

create or replace function public.feedback_rate_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.feedback_messages where user_id = new.user_id and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Too many messages. Please try again later.';
  end if;
  return new;
end $$;

drop trigger if exists feedback_rate_limit_trg on public.feedback_messages;
create trigger feedback_rate_limit_trg before insert on public.feedback_messages
  for each row execute function public.feedback_rate_limit();

alter table public.feedback_messages enable row level security;
drop policy if exists "add own feedback" on public.feedback_messages;
create policy "add own feedback" on public.feedback_messages
  for insert to authenticated with check (auth.uid() = user_id);

revoke all on public.feedback_messages from public, anon, authenticated;
grant insert on public.feedback_messages to authenticated;
grant all on public.feedback_messages to service_role;

notify pgrst, 'reload schema';
commit;
