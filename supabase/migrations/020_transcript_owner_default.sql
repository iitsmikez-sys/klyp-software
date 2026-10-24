-- The processing service inserts with a verified user bearer token. Populate
-- the required owner from that token before the existing RLS check runs.
alter table public.transcripts
  alter column user_id set default auth.uid();
