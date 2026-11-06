-- Automatic emails to new accounts that have not run a video yet: one about 10 minutes after signup, one at 24 hours.
-- Each account is marked when an email goes out so nobody gets the same one twice, and a person can turn the
-- emails off with the unsubscribe link.
--
-- Every account that exists when this runs is marked as already emailed, so only signups after this point are
-- contacted. The marking happens only the first time (when the columns are added), so running this file again
-- never marks newer accounts by mistake.
begin;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles' and column_name = 'activation_email_1_at'
  ) then
    alter table public.profiles add column activation_email_1_at timestamptz;
    alter table public.profiles add column activation_email_2_at timestamptz;
    alter table public.profiles add column activation_emails_off boolean not null default false;
    update public.profiles set activation_email_1_at = now(), activation_email_2_at = now();
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
