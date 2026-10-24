-- Apply manually in Supabase SQL editor after 016_vertical_layout.sql. Never run automatically.
-- Private immutable originals, uploaded directly with a service-issued signed token.
begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('editor-media', 'editor-media', false, 52428800,
 array['image/jpeg','image/png','image/webp','video/mp4','video/quicktime','video/webm'])
on conflict (id) do update set public=false, file_size_limit=excluded.file_size_limit,
 allowed_mime_types=excluded.allowed_mime_types;

-- Composite FK guarantees that the clip belongs to the recorded creator.
create unique index if not exists clips_id_user_id_unique on public.clips(id,user_id);
create table if not exists public.editor_assets (
 id uuid primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 clip_id uuid not null,
 storage_path text not null unique,
 file_name text not null check (char_length(file_name) between 1 and 255),
 kind text not null check (kind in ('photo','video')),
 declared_size bigint not null,
 declared_mime text not null,
 status text not null default 'pending' check (status in ('pending','verified','failed')),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default (now()+interval '3 hours'),
 verified_at timestamptz,
 mime_type text,
 size_bytes bigint,
 width integer,
 height integer,
 duration_ms integer,
 foreign key (clip_id,user_id) references public.clips(id,user_id) on delete cascade,
 check (storage_path ~ ('^'||user_id::text||'/'||clip_id::text||'/'||id::text||'\.(jpg|jpeg|png|webp|mp4|mov|webm)$')),
 check (declared_size > 0 and declared_size <= case when kind='photo' then 10485760 else 52428800 end),
 check ((kind='photo' and declared_mime in ('image/jpeg','image/png','image/webp')) or
        (kind='video' and declared_mime in ('video/mp4','video/quicktime','video/webm'))),
 check (expires_at >= created_at+interval '3 hours'),
 check (status <> 'verified' or (
  verified_at is not null and mime_type is not null and mime_type=declared_mime and
  size_bytes is not null and size_bytes=declared_size and
  width is not null and height is not null and width between 1 and 8192 and height between 1 and 8192 and
  width::bigint*height::bigint <= 33554432 and
  ((kind='photo' and duration_ms is null) or (kind='video' and duration_ms is not null and duration_ms between 1 and 60000))
 ))
);
create index if not exists editor_assets_clip_owner_idx on public.editor_assets(user_id,clip_id,created_at);
create index if not exists editor_assets_expiry_idx on public.editor_assets(expires_at) where status <> 'verified';

-- No foreign keys: cleanup must survive clip/account cascades and direct asset deletion.
-- UUID object paths are never reused. Preserve the manifest until storage removal succeeds.
create table if not exists public.editor_asset_cleanup (
 storage_path text primary key,
 not_before timestamptz not null,
 created_at timestamptz not null default clock_timestamp()
);
create index if not exists editor_asset_cleanup_due_idx on public.editor_asset_cleanup(not_before);
alter table public.editor_asset_cleanup enable row level security;
revoke all on public.editor_asset_cleanup from public, anon, authenticated;
grant all on public.editor_asset_cleanup to service_role;

create or replace function public.enqueue_editor_asset_cleanup()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
 -- Supabase signed upload tokens live for two hours. A full three hours after
 -- deletion also covers an in-flight upload/signing request and clock skew.
 insert into public.editor_asset_cleanup(storage_path,not_before)
 values (old.storage_path,greatest(old.expires_at,clock_timestamp()+interval '3 hours'))
 on conflict (storage_path) do update
 set not_before=greatest(public.editor_asset_cleanup.not_before,excluded.not_before);
 return old;
end;
$$;
revoke all on function public.enqueue_editor_asset_cleanup() from public, anon, authenticated;
drop trigger if exists editor_assets_enqueue_cleanup on public.editor_assets;
create trigger editor_assets_enqueue_cleanup before delete on public.editor_assets
 for each row execute function public.enqueue_editor_asset_cleanup();

alter table public.editor_assets enable row level security;
revoke all on public.editor_assets from anon, authenticated;
grant select on public.editor_assets to authenticated;
grant all on public.editor_assets to service_role;
drop policy if exists "read owned editor assets" on public.editor_assets;
create policy "read owned editor assets" on public.editor_assets for select to authenticated using (
 user_id=auth.uid() and exists (select 1 from public.clips c where c.id=clip_id and c.user_id=auth.uid())
);
-- No client insert/update/delete policies: clients cannot claim or forge verification.
-- No storage write policies: signed non-upsert tokens authorize a single immutable path.
drop policy if exists "read owned verified editor media" on storage.objects;
create policy "read owned verified editor media" on storage.objects for select to authenticated using (
 bucket_id='editor-media' and exists (
  select 1 from public.editor_assets a
  join public.clips c on c.id=a.clip_id and c.user_id=a.user_id
  join public.profiles p on p.id=a.user_id
  where a.storage_path=name and a.user_id=auth.uid() and a.status='verified'
   and p.tier='pro' and p.stripe_subscription_id is not null
 )
);

commit;
-- Railway sweeps pending/failed rows after three hours (token lifetime is two hours),
-- removes storage objects first, and only then removes rows. Failed sweeps retry.
-- Every row deletion also enqueues an independent storage manifest, including FK
-- cascades for verified, pending and failed assets. Railway drains due queue rows
-- only after successful storage removal; failures retain the manifest for retry.
-- Verified assets survive redeploys and are cleaned only after their row is deleted.
