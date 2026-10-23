-- Apply manually in Supabase SQL editor after 013_clip_edit_draft.sql.
-- The server validates the versioned JSON before writing; keep direct profile
-- writes under the existing RLS policy rather than granting a broad update.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS vertical_layout jsonb;
