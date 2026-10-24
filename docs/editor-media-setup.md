# Saved-clip editor media setup

The editor imports photos and muted video cutaways into a private persistent `editor-media` bucket. Original stream audio continues underneath. Import/save/export require the clip owner's confirmed Pro subscription.

## Apply migration 017 manually

Confirm the draft column from migration 013 and vertical layout column from migration 016 are installed. Preserve main migrations 014 (analysis history) and 015 (free allowance ledger); their presence in the repository does not establish live application. After migration 016, open the intended Supabase project's **SQL Editor** and paste the complete contents of [`supabase/migrations/017_editor_media.sql`](../supabase/migrations/017_editor_media.sql). Review the project and SQL, then run it there. Do not apply this migration through the CLI or deployment scripts.

Migration 017 creates the `public.editor_assets` table with ownership constraints and read policies, the private `editor-media` storage bucket, and a service-role-only `public.editor_asset_cleanup` queue. Its `BEFORE DELETE` trigger preserves storage paths when asset, clip, or account rows are deleted, including direct database cascades. The application returns an unavailable error if a required table or bucket is missing. No live schema installation is established by the local test suite.

After application, inspect the results with these read-only SQL queries:

```sql
select id, public, file_size_limit, allowed_mime_types
from storage.buckets where id = 'editor-media';

select relrowsecurity from pg_class
where oid = 'public.editor_assets'::regclass;

select relrowsecurity from pg_class
where oid = 'public.editor_asset_cleanup'::regclass;

select tgname, pg_get_triggerdef(oid)
from pg_trigger where tgrelid='public.editor_assets'::regclass and not tgisinternal;

select has_table_privilege('authenticated','public.editor_asset_cleanup','SELECT') as client_can_read,
       has_table_privilege('service_role','public.editor_asset_cleanup','DELETE') as worker_can_delete;

select schemaname, tablename, policyname, cmd, roles, qual
from pg_policies
where (schemaname = 'public' and tablename = 'editor_assets')
   or (schemaname = 'storage' and tablename = 'objects'
       and policyname = 'read owned verified editor media');
```

Expect a private bucket (`public = false`), a 52,428,800-byte bucket limit and the six MIME types in the migration, row-level security enabled, and both named owner-read policies. Photo limits remain 10 MB in application validation; video limits are 50 MB and 60 seconds. Inspect ownership constraints and policies in the migration as part of the schema review. These administrative queries do not replace authenticated owner/non-owner behavior checks.

## Configure both services

- Frontend and processing: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and server-only `SUPABASE_SERVICE_ROLE_KEY` for the same Supabase project. Never expose the service-role key as a public variable.
- Frontend: set `NEXT_PUBLIC_PROCESSING_API_URL` to the processing service's HTTPS URL.
- Processing: set `DEPLOYMENT_TARGET=processing` and `ALLOWED_ORIGIN` to the frontend origin. Install FFmpeg and FFprobe with the decoders required for the allowed media types. Finalization validates and decodes the actual uploaded bytes there.
- Local combined server: use `DEPLOYMENT_TARGET=processing` and leave `NEXT_PUBLIC_PROCESSING_API_URL` empty.

The browser uploads directly to private storage with a short-lived signed URL. The processing service verifies the object and marks the asset ready; a pending upload cannot be inserted into a saved draft. Preview URLs expire and refresh. Verified originals live in Supabase storage, independently of the processing cache or redeploys. The processing startup worker cleans abandoned pending/failed uploads after the signed-upload lifetime has elapsed.

Deletion cleanup waits until the later of the asset expiry and **three hours after deletion**, covering the two-hour signed upload token lifetime plus a buffer. This includes pending and failed uploads: replaying a token after its parent row is deleted can still upload bytes, which remain covered by the queue. The processing worker runs at startup and every 15 minutes, removes due objects through the Storage API, and acknowledges queue rows only after successful removal. Storage or database failures retain the manifest for retry. Existing verified assets with live rows are preserved. Storage cleanup is eventual and requires a running processing worker; monitor its `[editor-media] storage cleanup failed` logs and overdue queue rows.

After applying migration 017 to a **test project**, manually run [`supabase/tests/017_editor_media_cleanup.sql`](../supabase/tests/017_editor_media_cleanup.sql) to exercise verified/pending/failed deletion through asset, clip, and account paths. The script rolls back all SQL fixtures and makes no storage calls. It has not been executed locally because no PostgreSQL runtime is available. Verify actual signed-token replay and Storage API cleanup in that test project separately.

Video import duration is the selected picture stream's duration, with presentation packet timestamps as the fallback when stream duration is missing. Longer imported audio does not extend the usable cutaway. Files without enough visual timing information are rejected instead of borrowing container/audio duration. The media library reads all result pages so older saved-draft assets remain selectable.

## Release verification

Use an existing owned saved clip; do not start VOD analysis or spend Sparks for testing. Import one photo and one video, save and reload, cut before the insert, seek/play across each interval, remove/undo, and export the current draft. Inspect the downloaded MP4's picture, original audio, captions, hook, timing, and playback. Confirm a different user cannot read/use the assets, and check missing assets, invalid/oversize uploads, unavailable source retry, archive fallback, and a narrow viewport.

Keep the PR draft until authenticated private-storage import → save/reload → export and real MP4 inspection pass. Local mocked service boundaries cannot establish deployed storage permissions, live authentication, or processing availability.
