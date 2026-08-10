-- Persists the raw per-VOD transcript (word-level ASR output) so it survives
-- past the single /api/analyze request that produced it — previously it only
-- ever existed in memory for that one request and was discarded afterward.
-- Backs keyword-weighted clip selection (match timestamps are computed from
-- `words` at analyze time — see findKeywordMatches in lib/analyze-pipeline.ts,
-- which does NOT depend on this table) and any future full-text search over
-- previously-analyzed VODs.
--
-- `url` uses the same convention as clips.url — either a VOD URL or an
-- "upload:<uuid>" reference for uploaded files.
--
-- Safe to run against the existing production tables: `create table if not
-- exists` no-ops if already applied, `create index if not exists` likewise,
-- and the RLS policies are dropped-and-recreated idempotently — same pattern
-- as migration 004.

create table if not exists public.transcripts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  url text not null,
  duration_seconds double precision not null,
  words jsonb not null,
  transcript_text text not null,
  created_at timestamptz not null default now()
);

create index if not exists transcripts_user_url_idx on public.transcripts (user_id, url);

-- Plain-English full-text index over transcript_text, for future keyword
-- search across previously-analyzed VODs. Not required for analyze-time
-- keyword weighting, which matches directly against the in-memory `words`
-- from the same request.
create index if not exists transcripts_text_search_idx
  on public.transcripts using gin (to_tsvector('english', transcript_text));

alter table public.transcripts enable row level security;

drop policy if exists "read own transcripts" on public.transcripts;
create policy "read own transcripts" on public.transcripts
  for select using (auth.uid() = user_id);

drop policy if exists "insert own transcripts" on public.transcripts;
create policy "insert own transcripts" on public.transcripts
  for insert with check (auth.uid() = user_id);
