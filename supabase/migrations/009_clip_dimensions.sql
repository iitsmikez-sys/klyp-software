-- 009: capture the five scoring dimensions the model already computes
-- Each is 0-20. Null on every clip saved before this migration, which is why
-- nothing is backfilled: inventing breakdowns for past clips would be fiction.
alter table public.clips
  add column if not exists dim_hype       smallint,
  add column if not exists dim_emotion    smallint,
  add column if not exists dim_skill      smallint,
  add column if not exists dim_comedy     smallint,
  add column if not exists dim_storyline  smallint;

alter table public.clips
  add constraint clips_dims_range check (
    (dim_hype      is null or dim_hype      between 0 and 20) and
    (dim_emotion   is null or dim_emotion   between 0 and 20) and
    (dim_skill     is null or dim_skill     between 0 and 20) and
    (dim_comedy    is null or dim_comedy    between 0 and 20) and
    (dim_storyline is null or dim_storyline between 0 and 20)
  );
