-- Where each account came from (for example "tiktok", "twitch", "offer-17", "direct"), saved once when the
-- account is new. Empty means the account was created before tracking started. A short source name only.
alter table public.profiles add column if not exists acquisition_source text;

alter table public.profiles drop constraint if exists profiles_acquisition_source_format;
alter table public.profiles add constraint profiles_acquisition_source_format
  check (acquisition_source is null or acquisition_source ~ '^[a-z0-9._-]{1,32}$');
