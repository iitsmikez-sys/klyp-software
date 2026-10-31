-- Pro YouTube publishing. Apply after 033, before enabling the UI and routes.
begin;

create table public.youtube_connections (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  refresh_token_enc text not null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.youtube_connections enable row level security;
revoke all on public.youtube_connections from public, anon, authenticated;
grant all on public.youtube_connections to service_role;

create table public.youtube_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  clip_id uuid references public.clips(id) on delete set null,
  request_key uuid not null,
  title text not null,
  description text not null default '',
  publish_at timestamptz,
  youtube_video_id text,
  status text not null check (status in ('processing', 'uploaded', 'scheduled', 'failed', 'needs_review')),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, request_key),
  unique (youtube_video_id)
);
create index youtube_posts_user_created_idx on public.youtube_posts(user_id, created_at desc);
-- An uncertain upload must be reviewed before another attempt for this clip.
create unique index youtube_posts_one_unresolved_clip_idx on public.youtube_posts(user_id, clip_id)
  where status in ('processing', 'needs_review');
alter table public.youtube_posts enable row level security;
create policy "read own youtube posts" on public.youtube_posts
  for select to authenticated using (auth.uid() = user_id);
revoke all on public.youtube_posts from public, anon, authenticated;
grant select on public.youtube_posts to authenticated;
grant all on public.youtube_posts to service_role;

notify pgrst, 'reload schema';
commit;
