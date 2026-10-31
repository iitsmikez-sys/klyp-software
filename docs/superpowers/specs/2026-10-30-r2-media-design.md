# Klyp private R2 media design (development only)

## Intent

Store uploaded VODs and saved clip media durably in private Cloudflare R2 Standard while Supabase remains the system of record for users, plans, Sparks, jobs, and clip metadata. A Railway restart must not turn an accepted upload into a missing source. Migrate old saved clips without deleting their Supabase originals until each R2 copy is verified. This document authorizes no production change, purchase, or customer-file deletion.

## Current state and constraints

- `POST /api/upload` streams a whole video to `UPLOAD_DIR`, probes it, and returns `upload:<uuid>`. The allowed size is 4 GiB. The path is normally a Railway volume; other processing paths resolve this local filename. A 5 GB volume can be filled by one allowed upload.
- The archive worker renders a master, a 540p proxy, and a poster into private Supabase `clip-media`. Migration 027 only marks a clip `stored` after all three objects appear in `storage.objects`. The worker currently retries a master at 720p when it exceeds the Free-plan 50 MB per-object limit.
- The development branch has migrations through 029 and is behind current `origin/main`. Its existing untracked plans and Supabase local config must remain untouched. This work stays on `feat/vod-discovery-quality`; integration with newer main needs a separate review before release.
- Existing `upload:<uuid>` references and Supabase archive paths remain readable during transition. No change to AI, billing, Sparks, pricing, or the editor is required.

## Approaches

1. **Single cutover**: replace the current upload and archive paths at once. Fewer branches in code, but a bad configuration could strand new uploads and saved clips. Rejected.
2. **Server-proxied R2 uploads**: stream through Railway to R2. Easier client change, but a dropped connection or worker restart forces a multi-GB upload to restart. Rejected for the durability requirement.
3. **Staged direct upload and dual-read migration (chosen)**: add an R2 adapter behind a disabled feature flag, direct multipart uploads, verified clip writes, and Supabase fallback reads. Only switch traffic after isolated tests and explicit release approval. This protects existing files but requires temporary dual-provider code and a manifest.

## Cloudflare setup needed before connected testing

- Cloudflare account with R2 enabled; this may require a billing profile, but no purchase is authorized here.
- One **private Standard-class** bucket for a staging environment, separate from any future production bucket. Provide its bucket name, account ID, and chosen jurisdiction/endpoint. Do not enable a public `r2.dev` URL or public custom domain.
- Bucket-scoped R2 S3 API token with read/write/list/delete on that staging bucket only. Its Access Key ID and Secret Access Key belong in local environment variables or a secret manager, never chat, Git, logs, or browser code. Use different credentials for production later.
- Browser upload CORS restricted to the local test origin for staging and to Klyp's actual origin for production. Only the required upload methods and headers should be allowed. CORS is not authentication.
- A cost-alert or usage-review process before production activation. R2's included allowance is not a hard spending ceiling.

No Cloudflare credentials are required to write or run unit tests with an in-memory S3-compatible fake. No live R2 call is part of this development preparation.

## VOD upload and restart recovery

1. The authenticated frontend requests an upload session. The server verifies the Supabase user, file type and declared size (at most 4 GiB), allocates a random object key scoped to that user, and writes an `uploads` row with `initiated`, expected bytes, expiry, and multipart ID. It returns short-lived signed part URLs. It never returns an R2 secret.
2. The browser sends fixed-size parts directly to R2, persists the upload/session ID and completed part list locally, and resumes missing parts after a network interruption or page reload. The server limits each session's part count, size, user, and expiry. A user cannot finalize another user's upload.
3. The server completes multipart upload, checks R2 `HEAD` size, probes the completed object, then marks the row `ready`. A range-capable probe is preferred; if the tool needs a full local file, require a scratch-space check before downloading. Only then may analysis accept `upload:<uuid>`. An incomplete or failed object never appears as an available VOD. Repeated finalize calls return the same ready result without another write.
4. The current analysis and export paths require a local uploaded-file path. Processing therefore resolves ready uploads from R2 into a unique local scratch file, with a free-space/concurrency check before a multi-GB download. A restart discards scratch but not the R2 source; the job can retry from the durable object. Existing volume uploads remain readable until separately migrated or expired.
5. A cleanup loop removes only locally generated scratch/temp files when no active lease uses them. It aborts expired multipart sessions and removes their DB rows only after confirmation. Completed source VODs are retained for a defined retry/reclip window; the default proposal is **five days after upload**, with deletion blocked while analysis or archive jobs still need the source. This VOD-source lifetime is separate from saved-clip retention and needs product review.

## Clip archive and migration

- New R2 clip objects use immutable keys for `master.mp4`, `proxy.mp4`, and `poster.jpg`, with a provider field in Supabase. The saved-clip state remains provisional until all three R2 objects pass `HEAD` checks for expected byte size and an application-computed SHA-256 digest. Multipart ETags are not treated as content hashes. A database finalization function must use a verified manifest rather than the current `storage.objects` check for R2.
- Keep current encoder settings for the initial switch. R2's larger object limit permits retaining a 1080p master that would otherwise be downgraded solely to fit Supabase Free's 50 MB cap. Estimate the higher stored bytes before enabling that improvement; never lower current quality.
- Reads choose the recorded provider. Old rows stay on Supabase. During migration, copy each existing stored master/proxy/poster byte-for-byte to R2, verify size/hash, then test preview and download before atomically changing the row's provider. Keep the Supabase original and a migration ledger for rollback. Missing historical objects are reported as unavailable, not silently marked migrated.
- The migration tool defaults to dry-run and has no deletion path. A later, separately approved retirement process can remove confirmed Supabase originals after a recovery window.

## Retention and cleanup

- Store `expires_at` explicitly for each saved clip when its backup is confirmed: Free = 5 days and Pro = 30 days, in UTC. Display that date to the owner before expiry. Plan transitions need explicit rules: a Pro upgrade may extend expiry; a downgrade must not shorten an already-promised date without notice.
- An idempotent cleanup worker claims expired rows, confirms no active migration/export lease, deletes R2 objects, then marks the clip expired. A failed deletion leaves a retryable manifest and does not claim success. Existing clips receive no retroactive expiry until a separate, reviewed migration.
- Use R2 prefix lifecycle rules only as a safety net, set later than the database expiry so the app can keep metadata and storage consistent. Abort incomplete multipart uploads after one day. R2 lifecycle deletion can lag, so it cannot be the sole state machine.

## Security and costs

- Supabase user ID and clip ownership gate every upload, preview, and download. Private R2 reads get short-lived signed GET URLs after authorization. Upload URLs have bounded expiry, unique random object keys, and validated content length/checksum at finalization. A presigned part URL can be replayed until it expires, so finalization must reject changed or duplicate parts and must never reuse an object key. Server secrets never reach the client.
- Count upload parts/bytes, object writes/reads, HEADs, deleted bytes, signed downloads, and Railway outbound bytes in an append-only usage table or aggregate. Record provider/object key, user, job, byte count, and timestamp without logging signed URLs or secrets. A dashboard/export can calculate R2 GB-month, Class A/B requests, R2 egress (currently free), and Railway egress using published rates. This is an estimate until reconciled with provider invoices.
- Reject new uploads when configured size/volume/concurrency limits would create uncontrolled spend. Keep R2 Standard, not Infrequent Access, for 5/30-day retention.

## Verification gates

1. Unit tests: ownership and size limits, multipart resume/idempotent finalize, failed/short objects, restart recovery, scratch cleanup with active lease, verified three-object archive, Supabase fallback, migration dry-run/hash mismatch, expiry by tier, delete retry, and usage accounting.
2. Isolated integration tests with a staging R2 bucket and isolated Supabase: upload, interrupt/resume, restart worker, analyze, archive, preview, download, expiry, and rollback. No paid AI calls; use local media and mocks for analysis.
3. Before any deployment, reconcile the branch with latest main, run full test/typecheck/build, enumerate migrations, verify no live keys or files touched, and obtain explicit production approval.

## Open decisions before connected testing or release

- Confirm whether users should be able to reclip an uploaded VOD for longer than the proposed five-day VOD-source lifetime.
- Confirm whether current saved clips are grandfathered indefinitely or receive a future announced expiry. This design defaults to grandfathering.
- Measure actual master/proxy/poster sizes and upload/preview traffic; current customer forecasts are illustrative only.
