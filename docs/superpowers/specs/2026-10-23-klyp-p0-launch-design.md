# Klyp P0 launch reliability design

The October 23 competitive audit and the user's approval define this release: preserve
livestreamers' discovered moments, prevent unowned or unmetered processing, and make
the Free and Pro promises match actual behavior before extending the editor in P1.

## Goals

- A Twitch VOD is not marked complete until its analysis result and charge are safely recorded. Failures are visible and retryable without duplicate charges or clips.
- Saved clip footage is queued for durable archival immediately. Stored media remains playable after the source disappears. Existing archival maintenance must not relabel stored clips as lost.
- Export, preview, and thumbnail processing require an owned saved clip or an owned analysis result; per-user compute use is bounded.
- Public plan copy states only current Klyp behavior.
- Automated and manual verification cover Free and Pro, success and failure paths.

## Constraints

- Keep Next.js, Supabase, Stripe, AssemblyAI, Claude, yt-dlp, and FFmpeg. Avoid adding a new infrastructure service for P0.
- Do not copy OpusClip copy, interface assets, or templates.
- Existing saved clips and edit drafts must remain readable.
- Database changes use a new migration and must be applied before code that depends on it is deployed.
- Production credentials and third-party behavior are unavailable in this checkout; report those checks as unverified until exercised in an authorized environment.

## Approach

Use Postgres as the durable job and ownership ledger, and the existing Railway processing service as worker. This avoids the loss of in-memory work on restart and keeps charges and clip writes transactional. A Redis queue would add operating cost and another deployment dependency; retaining the current process-local queue alone cannot meet crash recovery or cross-request idempotency.

Keep manual editing and current export behavior. P1 will address caption templates, new layouts, and AI edit features after the P0 flow is verified.
