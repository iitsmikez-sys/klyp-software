# Klyp setup and release order

## Services

The frontend runs on Vercel. The processing service runs the same Next.js app on a persistent Node 20.9+ host with FFmpeg and yt-dlp installed. Set `DEPLOYMENT_TARGET=processing` there; it serves analysis, preview, thumbnail, duration, and export routes and starts the background workers. Supabase stores accounts, Sparks, clips, queues, and private archived media. Stripe handles Pro subscriptions.

## Database first

For this consolidated branch, apply `028_analysis_jobs.sql` after existing `024_vod_analysis_cache.sql` through `027_archive_confirmation_guard.sql`. Do not substitute the earlier worktree's conflicting `024_analysis_jobs.sql`. Set `KLYP_UPLOAD_DIR` to a persistent processing volume; a container-local upload directory will not survive replacement.

Apply the numbered SQL migrations in `supabase/migrations/` in order **before** deploying either service. Verify the earlier `006_transcripts.sql` and `013_clip_edit_draft.sql` migrations are present, then apply `016_auto_vod_jobs.sql` through `027_archive_confirmation_guard.sql`. Migration 017 creates the private `clip-media` storage bucket and queues saved clips that have not been archived. Migration 018 adds versioned editor drafts; 019 adds private creator feedback; 020 supplies the transcript owner default; 021 matches the numeric clip timestamps in the existing production schema; 022 stores a profile layout; 023 adds the separate private `editor-media` bucket and cleanup queue; 024 adds the VOD analysis cache; 025 prevents an expired Pro profile read from granting paid Sparks; 026 makes local table grants explicit; and 027 prevents a clip from being marked stored until its private master, proxy, and poster objects exist. These migrations do not delete existing clips. If migrations are applied through the SQL Editor, reconcile the migration history before subsequently using the Supabase CLI. See [production-release-checklist.md](docs/production-release-checklist.md) for preflight, hosted verification, and rollback steps.

The processing service needs `SUPABASE_SERVICE_ROLE_KEY` for claimed jobs and private media uploads. Keep this key server-side. The frontend needs the normal public Supabase URL and anon key. Both deployments must use the same Supabase project.

An archive is durable only when the clip shows **Footage saved**. New clips show **Saving footage** while the worker runs. The worker caps each stored object at 50 MiB; monitor total Supabase Storage usage as the library grows. Uploaded source videos currently live in the processing service's local cache until their clips finish archiving, so restarting that service before archival completes can leave those clips unavailable.

## Processing credentials

Set the variables in `.env.example` that match your enabled sources and AI pipeline: AssemblyAI, Anthropic, Twitch app credentials, and the Twitch EventSub signing secret. Set the Twitch OAuth callback URL for the frontend and route EventSub deliveries to the processing service. The processing service needs sufficient disk space for temporary video segments and FFmpeg outputs. Configure `FFMPEG_PATH` and `YTDLP_PATH` if the executables are not on `PATH`.

During the limited launch, manual analysis verifies VOD duration on the server and rejects sources longer than 10 hours before paid transcription or AI work. Automatic clipping skips longer VODs without a Sparks debit and notifies the creator. The browser's duration estimate does not authorize processing.

## Stripe

Set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` on the frontend. `STRIPE_PRICE_PRO` is optional. If configured, the Stripe Price must be active, $28 USD, and monthly; checkout rejects any mismatch with the advertised price. Route `checkout.session.completed`, `invoice.paid`, `customer.subscription.updated`, and `customer.subscription.deleted` to `/api/stripe/webhook`. The paid invoice event is required for both first-payment and renewal Sparks grants. Use a separate test-mode webhook secret and Stripe test key for an isolated test deployment.

## Release checks

1. Run `npx tsc --noEmit`, the Node test suite, and `npm run build`.
2. In a test Supabase/Stripe environment, connect a Twitch channel, publish a VOD, and confirm one queued job produces saved clips and exactly one Sparks debit.
3. Save a manual analysis clip and confirm its archive status becomes `stored`; then preview and export from the archived media.
4. Check retry states by temporarily failing processing/storage, restoring it, and confirming the job resumes without duplicate clips or charges.
5. Test Free and Pro checkout/webhook paths in Stripe test mode. Confirm the checkout amount matches the pricing page.
6. On two signed-in devices, edit the same clip, check cloud draft recovery and conflict handling, and verify imported media remains available.
7. Export a cropped clip, a facecam/game layout, each animated caption template, and a transcript cut; compare the file against the editor preview.
8. Run a Gaming VOD, IRL VOD, long VOD, file upload, and deleted-source playback through the real processing service. Inspect feedback and the bounded visual-check logs. The still-frame check can fail without failing analysis; record that state separately.

The database and local automated tests verify the queue transitions. A live Twitch, storage, and Stripe test is still required before considering the release deployed.
