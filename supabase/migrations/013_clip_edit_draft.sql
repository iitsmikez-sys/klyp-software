-- Run by hand in the Supabase SQL editor after 012. Do not apply with a CLI.
-- Analysis fields remain unchanged; one nullable JSON draft stores saved edits.
alter table public.clips
  add column if not exists edit_draft jsonb;
