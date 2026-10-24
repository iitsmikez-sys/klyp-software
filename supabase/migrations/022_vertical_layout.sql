-- Apply manually in Supabase SQL editor after 021_archive_numeric_timestamps.sql.
-- The server validates the versioned JSON before writing; keep direct profile
-- writes under the existing RLS policy rather than granting a broad update.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS vertical_layout jsonb;
