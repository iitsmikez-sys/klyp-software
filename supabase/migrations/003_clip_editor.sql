-- Saved-clip editor: persist hook options and word timestamps so clips can be
-- re-exported with hooks/captions from the My Clips page.
-- hooks: text[] of the 3 AI-generated hook lines.
-- words: jsonb array of { text, start, end } (ms, VOD-absolute) for caption burn.
alter table public.clips
  add column if not exists hooks jsonb,
  add column if not exists words jsonb;
