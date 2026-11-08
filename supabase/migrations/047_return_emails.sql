-- A follow-up email for free accounts that ran exactly one video and have not come back, plus the one-click answers
-- people give when they open it ("why didn't you keep the clips?").
--
--  * profiles.return_email_at marks the email as sent, so nobody gets it twice.
--  * return_feedback holds one answer per person (a later answer replaces the earlier one). Only the server reads
--    and writes it: nobody can read other people's answers from the browser.
--
-- Safe to run more than once. Existing accounts are NOT marked: the email only goes to people whose one video
-- finished 2 to 4 days ago, so older accounts fall outside its window on their own.
begin;

alter table public.profiles add column if not exists return_email_at timestamptz;

create table if not exists public.return_feedback (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  reason text not null check (reason in ('not_good', 'missed', 'cuts', 'slow', 'looking')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.return_feedback enable row level security;
revoke all on public.return_feedback from public, anon, authenticated;
grant all on public.return_feedback to service_role;

notify pgrst, 'reload schema';
commit;
