# Klyp production release checklist

Updated 2026-10-29 for `feat/vod-discovery-quality` after merging `origin/main` at `89df411`. Record the final release commit at sign-off. **Planning only:** no production migration, deployment, or customer-data change has been made by this checklist.

## Release gates before approval

- [ ] Refresh `origin/main` and confirm the intended release commit includes all required fixes. Resolve any new conflicts without overwriting the existing branch. Record the exact frontend and processing commit IDs and the current production commit IDs.
- [ ] Review the branch diff and preserve the untracked design documents and local Supabase config; do not include those files accidentally.
- [ ] Run `npm ci`, `npm run typecheck`, `npm test`, and `npm run build` on the exact release commit in a clean Linux/hosting-equivalent environment. Local TypeScript, 222 scripted unit tests, 34 focused layout tests, and the four-viewport dashboard browser check passed after the merge. The clean Linux production build remains a gate: this sandbox denies WSL access, and the Windows build fails with `EPERM` in generated `.next` files.
- [ ] Check the production Supabase migration history, actual schema, row-level policies, RPC privileges, and private Storage buckets **read-only**. Do not infer applied migrations from files in Git. Run `scripts/check-release-state.mjs` and `scripts/check-archive-capacity.mjs` with production server credentials in a secure environment; do not print keys. Inspect a sample of pre-existing `stored` clips for all three actual private objects because migration 027 does not repair earlier false `stored` rows.
- [ ] Confirm a restorable database backup and a way to restore private `clip-media` and `editor-media` objects. Record current archive backlog, storage capacity, webhook error rate, Sparks balances for test accounts, and recent Stripe event IDs. Confirm a maintenance/feature-stop path for new clip saves, paid analyses, and checkout if rollback is needed.
- [ ] Verify frontend (Vercel) and persistent processing host configuration without revealing values: same production Supabase URL/anon key, server-only service role key where required, processing URL and allowed origin, `DEPLOYMENT_TARGET=processing` only on processing, FFmpeg/yt-dlp and temporary disk, Anthropic/AssemblyAI/Twitch credentials only on appropriate service, and production Stripe key/webhook secret/active $28 monthly Price on frontend. Keep `KLYP_DISCOVERY_V2` disabled and Opus selection unchanged unless separately approved. Confirm processing worker is enabled only where intended.
- [ ] Obtain explicit approval for applying migrations and deployment. The local test alone is not approval to change production.

## Database order after approval, before application deployment

Migration `028_analysis_jobs.sql` follows existing migrations `024`–`027`. Never apply the older reliability worktree's conflicting `024_analysis_jobs.sql` or overwrite historical migrations. Verify the analysis RPC and transcript columns in isolated Supabase before release.

1. Compare production history and actual objects with migrations `001`–`023`. Apply only **missing** numbered migrations in order. In particular, `016` adds auto VOD jobs, `017` creates the private `clip-media` bucket and archive queue/backfill, `018`–`023` add editor drafts, feedback, owner defaults, numeric timestamp compatibility, layout, and private editor media/cleanup. If history and objects disagree, stop and reconcile; never rerun a destructive or backfill migration blindly.
2. Apply `024_vod_analysis_cache.sql` (new cache tables and bounded retry RPC), `025_paid_sparks_invoice_only.sql` (paid refills require a verified invoice), `026_local_table_privileges.sql` (explicit grants), `027_archive_confirmation_guard.sql` (new saves start pending; stored requires master, proxy, and poster in private Storage), then `028_analysis_jobs.sql` (durable analysis jobs and exactly-once result commit through the existing `record_analysis_clips` RPC). The five numbers are unique. Migrations 024–027 passed prior local application; 028 passed isolated SQL-backed tests but its application through the Supabase CLI has not been verified in this sandbox. Verify the full ordered chain in isolated Supabase before production approval.
3. Do **not** replay modified historical `003` or `012` against an installed database. The `003` change fixes fresh bootstrap ordering. Migration `025` carries the relevant paid-refill behavior forward from `012` for an existing database.
4. Recheck schema/RPC permissions, both private buckets, archive queue counts, and a forged `stored` insert test **only in an isolated test database**. On production, use read-only checks and watch for new clip rows beginning at `pending` after rollout.

## Application rollout after database checks

1. Deploy the exact reviewed commit to the processing host first. Confirm it boots with FFmpeg/yt-dlp, serves only intended processing routes, and starts the archive/cleanup workers. Monitor queue failures, retries, disk, and Storage usage. Keep new paid VOD processing paused until the host is healthy.
2. Deploy the same commit to the frontend. Confirm auth routes, processing routing, Stripe webhook endpoint, and environment variable scope. Do not paste credentials into logs or browser variables.
3. Enable a small controlled cohort only after the checks below pass. Keep automatic discovery/`KLYP_DISCOVERY_V2` off until the separate clip-quality release is approved.

## Hosted verification after approval

- [ ] Set `KLYP_UPLOAD_DIR` to a persistent processing volume and confirm an uploaded VOD is readable after worker restart and container replacement. A container-local folder is insufficient.
- [ ] In isolated Supabase, apply migrations through 028 and verify disconnect, reconnect, saved transcript and result recovery, duplicate requests, and exactly-once Sparks charging without paid provider calls.

- [ ] Frontend and processing deployment build/health logs clean; no missing migration, bucket, secret, FFmpeg, yt-dlp, or worker startup errors.
- [ ] Disposable account can sign up, confirm email if required, log in, log out, and log back in; another account cannot read its clips or media.
- [ ] In a **hosted isolated Supabase + Stripe test-mode environment**, complete Checkout and verify one paid invoice sets Pro and exactly 500 Sparks, duplicate delivery does not grant twice, renewal grants once, and failed payment grants nothing. Local Checkout/webhook passed, but hosted delivery has not been verified. Do not point an isolated Preview at production customer data or switch the live storefront to test keys. If isolated hosted Supabase is unavailable, mark this gate **NOT VERIFIED** until an approved safe environment or explicit live canary is arranged.
- [ ] Verify webhook signature validation and delivery for `checkout.session.completed`, `invoice.paid`, `customer.subscription.updated`, and `customer.subscription.deleted`; monitor failed-payment events. Check Stripe delivery status, Klyp logs, `stripe_events`, `spark_transactions`, profile tier, and Sparks balance. Do not use real cards for test-mode checks.
- [ ] Verify displayed Sparks estimate matches an actual deduction, retries/concurrent requests charge once, insufficient balance stops processing, a failed job refunds correctly, and history shows the grant/charge/refund.
- [ ] With an authorized short VOD or preapproved no-cost fixture, check distinct usable clips, complete payoffs, preview, editor, export, save status, private archive objects, reopen/download after source loss, and recovery after a processing restart. No paid AI call is authorized by this checklist; use existing results/fixtures unless separately approved.
- [ ] Check old `stored` clips for actual objects and show unavailable legacy clips honestly. Monitor archive `pending`, `retry`, `processing`, `failed`, `unavailable`, and worker logs; do not advertise a clip as backed up until `stored` is confirmed.

## Rollback / stop conditions

- **Stop rollout** on missing migration, failed build, incorrect Stripe price or Spark grant, duplicate grant/charge, exposed secret, broken export, or a clip marked saved without all three private objects. Pause new checkout/paid analysis/clip saves as needed; leave incoming Stripe events observable and retain IDs for reconciliation.
- **Application rollback:** redeploy the recorded last known-good frontend/processing commits only if they remain compatible with the migrated schema. Do not roll back to a billing version that can double-credit; if necessary, keep checkout disabled until a forward fix is ready. Keep queued jobs and stored objects intact. Recheck any partially processed archive jobs and leases before restarting workers.
- **Database rollback:** no automatic SQL down-migrations are supplied. Migrations `024`–`028` add or replace schema/functions, and `017` can backfill many existing clips. Prefer a forward correction. Restore from the verified database backup only under a coordinated recovery plan that reconciles Stripe invoices/events, Sparks ledger, new signups, clips, and private Storage changes since the backup. A code rollback does not undo database or Storage writes.
- **After recovery:** run the hosted checks again and reconcile every test invoice and pending archive job. Do not reopen sales until billing and clip durability are verified.

## Current status

- Prior isolated local checks passed signup/login, Stripe **test-mode** Checkout to a local signed webhook, Pro/500-Sparks allocation, MP4 export, durable archive, source-loss recovery, and restart recovery. Duplicate and failed-payment behavior passed local signed-event tests. After the merge, `npm test` passed 222/222, focused framing tests passed 34/34, `npm run typecheck` passed, and the dashboard browser check passed at 1920×1080, 1440×900, 1280×800, and 390×844.
- Production migration state, clean Linux build, hosted Stripe delivery, hosted worker capacity, and production clip behavior are **not verified**. The processing host has no persistent upload volume in the latest read-only audit. No production deployment is approved or performed.
