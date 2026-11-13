-- Which Pro free trials have been used, so one person cannot get a second trial with another account.
-- Each used trial stores two keys: the account's real email ("email:ab@gmail.com", dots and +tags removed) and the card
-- ("card:<Stripe fingerprint>"). Only the server (service role) reads or writes it: RLS is on and there are no policies.
create table if not exists public.trial_uses (
  key        text primary key,
  user_id    uuid not null,
  created_at timestamptz not null default now()
);

create index if not exists trial_uses_user_idx on public.trial_uses (user_id);

alter table public.trial_uses enable row level security;
