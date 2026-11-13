-- Signup guards for the free plan's 60 Sparks.
--   1. Throwaway email services cannot sign up (the list is the table blocked_email_domains; add a row to block another).
--   2. The same real email cannot sign up twice: Gmail dots and "+tags" are ignored (a.b+x@gmail.com is ab@gmail.com).
-- It runs before every new account is created, whatever the signup path (email, Google, Discord), so it cannot be skipped
-- from the browser. Existing accounts are untouched. @klyp.world addresses are always allowed.
--
-- To switch it off again:   drop trigger if exists guard_new_user on auth.users;

create table if not exists public.blocked_email_domains (
  domain text primary key
);
alter table public.blocked_email_domains enable row level security;

insert into public.blocked_email_domains (domain) values
  ('mailinator.com'),
  ('yopmail.com'),
  ('yopmail.fr'),
  ('guerrillamail.com'),
  ('guerrillamail.net'),
  ('guerrillamail.org'),
  ('guerrillamail.biz'),
  ('sharklasers.com'),
  ('grr.la'),
  ('10minutemail.com'),
  ('10minutemail.net'),
  ('tempmail.com'),
  ('temp-mail.org'),
  ('temp-mail.io'),
  ('tempmailo.com'),
  ('throwawaymail.com'),
  ('trashmail.com'),
  ('trashmail.net'),
  ('getnada.com'),
  ('nada.email'),
  ('dispostable.com'),
  ('maildrop.cc'),
  ('mohmal.com'),
  ('emailkeep.com'),
  ('hidingpost.com'),
  ('playfine.com'),
  ('fakeinbox.com'),
  ('mailnesia.com'),
  ('moakt.com'),
  ('mytemp.email'),
  ('mintemail.com'),
  ('tempinbox.com'),
  ('burnermail.io'),
  ('inboxkitten.com'),
  ('emailondeck.com')
on conflict do nothing;

create or replace function public.normalize_email(e text)
returns text
language plpgsql immutable
as $$
declare
  t text := lower(btrim(coalesce(e, '')));
  at_pos int;
  loc text;
  dom text;
  plus_pos int;
begin
  if position('@' in t) < 2 then
    return t;
  end if;
  at_pos := length(t) - position('@' in reverse(t)) + 1;
  loc := left(t, at_pos - 1);
  dom := substr(t, at_pos + 1);
  if dom = 'googlemail.com' then
    dom := 'gmail.com';
  end if;
  plus_pos := position('+' in loc);
  if plus_pos > 1 then
    loc := left(loc, plus_pos - 1);
  end if;
  if dom = 'gmail.com' then
    loc := replace(loc, '.', '');
  end if;
  return loc || '@' || dom;
end $$;

create or replace function public.guard_new_user()
returns trigger
language plpgsql security definer set search_path = public, auth
as $$
declare
  dom text;
  norm text;
begin
  -- Sign-ins without an email (phone, anonymous) are not covered here.
  if new.email is null or new.email = '' then
    return new;
  end if;
  dom := lower(split_part(new.email, '@', 2));
  if dom = 'klyp.world' then
    return new;
  end if;
  if exists (select 1 from public.blocked_email_domains b where b.domain = dom) then
    raise exception 'blocked_email_domain';
  end if;
  norm := public.normalize_email(new.email);
  if exists (
    select 1 from auth.users u
    where u.id <> new.id and u.email is not null and public.normalize_email(u.email) = norm
  ) then
    raise exception 'duplicate_email';
  end if;
  return new;
end $$;

drop trigger if exists guard_new_user on auth.users;
create trigger guard_new_user
  before insert on auth.users
  for each row execute function public.guard_new_user();
