# Private R2 staging gate (development only)

Do not point this branch at production Supabase or a production R2 bucket. No
Cloudflare request, purchase, migration, or customer-file deletion is part of
the mock tests. The connected test must wait until the owner chooses to enable
R2; Cloudflare currently requires R2 activation before S3 token creation.

## Owner setup, when ready for a connected staging test

1. In Cloudflare R2, create a separate **Standard** bucket with the default
   jurisdiction unless a different jurisdiction is required. Keep public
   `r2.dev` access and custom-domain public access off. Record the account ID,
   bucket name, and jurisdiction in local environment settings only.
2. Create an **Object Read & Write** R2 S3 token scoped only to that staging
   bucket. Store its Access Key ID and Secret Access Key locally, never in
   chat, Git, screenshots, or browser code.
3. In that bucket's CORS settings, allow only the exact local test origin,
   e.g. `http://localhost:3000`, with `PUT` and `Content-Type` as an allowed
   header. The browser PUTs signed parts directly; CORS is not authorization.
4. Use an isolated Supabase project/database and apply migrations 030–033
   after the existing 001–029 chain. Do not use customer data. Set service
   role credentials on the local processing server only.
5. Put `R2_ENABLED=1`, `R2_WRITES_ENABLED=1`, `R2_BUCKET`, `R2_ACCOUNT_ID`,
   `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and optionally
   `R2_JURISDICTION=default|eu|us|fedramp|fedramp-high` in that local server's
   environment. Keep `R2_RETENTION_CLEANUP_ENABLED=0` for the first connected
   tests. No R2 secret goes in a `NEXT_PUBLIC_` variable.
6. Check a permitted short upload, browser interruption/resume, worker
   restart/recovery, archive, preview, export, and private access denial.
   Verify the R2 object sizes/hashes and Supabase manifest. Then test cleanup
   against disposable staging objects with `R2_RETENTION_CLEANUP_ENABLED=1`.
7. Review `r2_usage_events` against Cloudflare's own metrics. Event bytes and
   counts are operational measurements, not an invoice. Set a Cloudflare
   usage/cost alert before any production decision.

For rollback of **new writes**, set `R2_WRITES_ENABLED=0` while leaving
`R2_ENABLED=1` and the read credentials available. Existing R2 archives then
remain readable. Do not remove R2 read credentials while R2-backed rows exist.
The one-clip migration tool defaults to dry-run; `--apply` additionally
requires `KLYP_R2_MIGRATION_APPROVED=staging`. It never deletes Supabase files.

Cloudflare references: [bucket privacy](https://developers.cloudflare.com/r2/buckets/create-buckets/),
[R2 token scope](https://developers.cloudflare.com/r2/api/tokens/),
[CORS](https://developers.cloudflare.com/r2/buckets/cors/), and
[jurisdiction endpoints](https://developers.cloudflare.com/r2/api/tokens/).
