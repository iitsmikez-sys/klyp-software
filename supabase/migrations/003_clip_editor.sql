-- Saved-clip editor: persist hook options and word timestamps so clips can be
-- re-exported with hooks/captions from the My Clips page.
-- hooks: jsonb array of the 3 AI-generated hook lines.
-- words: jsonb array of { text, start, end } (ms, VOD-absolute) for caption burn.
-- A fresh database creates public.clips in 004_clips_rls.sql, which also adds
-- these columns. Keep this migration useful for older databases with clips.
do $$
begin
  if to_regclass('public.clips') is not null then
    alter table public.clips
      add column if not exists hooks jsonb,
      add column if not exists words jsonb;
  end if;
end $$;
