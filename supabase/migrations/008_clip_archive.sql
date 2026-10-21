-- Clip archival — run in the Supabase SQL editor (after 001-007).
--
-- Klyp stored clips as a source URL plus timestamps and never kept the footage.
-- Twitch deletes VODs after a few weeks, so saved clips quietly stopped being
-- re-exportable: measured on this project, 89 of 112 clips (79%) already have
-- no retrievable source. This adds the columns needed to keep a copy.
--
-- Two assets per clip, both in the private `clip-media` bucket:
--   master_path — 1080p cut, used for re-exports (9:16 / 1:1 / 16:9)
--   proxy_path  — 540p cut, served to the preview player (~10x smaller, so
--                 previewing a library doesn't stream 1080p masters)
--   poster_path — single still frame
--
-- archive_status is the state machine the UI reads:
--   none       — never attempted (every pre-existing row starts here)
--   pending    — queued
--   processing — upload in flight
--   stored     — master + proxy present; the clip survives its source
--   failed     — attempt failed, archive_error says why; retryable
--   unavailable— source is gone, nothing to archive. Terminal, and honest:
--                these rows are NOT deleted and are NOT claimed as recovered.

alter table public.clips
  add column if not exists master_path text,
  add column if not exists proxy_path text,
  add column if not exists poster_path text,
  add column if not exists archive_status text not null default 'none',
  add column if not exists archive_error text,
  add column if not exists archived_at timestamptz,
  add column if not exists archive_bytes bigint;

-- Guard the state machine so a typo can't invent a status the UI won't handle.
alter table public.clips drop constraint if exists clips_archive_status_check;
alter table public.clips
  add constraint clips_archive_status_check
  check (archive_status in ('none','pending','processing','stored','failed','unavailable'));

-- The archiver claims work by status; keep that lookup cheap.
create index if not exists clips_archive_status_idx
  on public.clips (archive_status)
  where archive_status in ('pending','processing','failed');

-- Idempotency for the archive worker, mirroring stripe_events in 007: a clip
-- is claimed by id, so a retried or duplicated job cannot upload twice or
-- double-charge. Rows are kept after success so a replay is a no-op.
create table if not exists public.clip_archive_jobs (
  clip_id uuid primary key references public.clips(id) on delete cascade,
  status text not null default 'processing',
  attempts int not null default 1,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.clip_archive_jobs enable row level security;
-- No end-user policies: only the service-role worker touches this.
