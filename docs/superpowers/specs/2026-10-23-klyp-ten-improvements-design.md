# Klyp ten-improvement release design

The user asked to finish the audit's ten highest-impact improvements and publish them only after the set is complete. Existing P0 changes for durable Twitch jobs, clip archival, truthful pricing, and owned processing are the base of this release.

## User outcome

Creators can trust that analyzed moments and saved footage survive failures, edit clips entirely in Klyp across devices, and get useful AI-assisted short-form suggestions without a claim of guaranteed virality. The preview and export must match. Real services must be exercised before calling the release live.

## Scope and constraints

- Finish and verify items 1–5 as launch reliability work, then implement items 6–10.
- Sync editor drafts per owned clip in Supabase with row-level security and an explicit conflict policy. Keep older local drafts readable.
- Give users manual placement controls for gameplay, facecam, IRL, and reaction footage. Automatic subject tracking is outside this ten-item scope.
- Build original animated caption templates; do not copy CapCut, OpusClip, or their assets.
- Let users remove transcript-aligned video ranges and accept or dismiss silence suggestions. Keep captions synchronized after cuts.
- Validate multimodal clip candidates using bounded frame samples and explicit measured creator feedback. Label scores as estimates, not virality guarantees.
- Keep Next.js, Supabase, Stripe, AssemblyAI, Claude, FFmpeg, and the existing Railway/Vercel split. Protect private media, auth, Sparks, and storage costs.
- Apply database migrations before deploying dependent code; use staging/test credentials for live VOD and Stripe checks.

## Approach

Extend the current editor and processing pipeline rather than replace them. Use Supabase for owned drafts and feedback, pure TypeScript helpers for time edits and crop settings, and FFmpeg for render parity. Use sampled frames only for finalists to bound multimodal cost. Promote the complete, verified branch through the current production deployment paths after migrations and live smoke tests.

## Completion evidence

Automated tests, typecheck, production build, real Gaming/IRL/long/upload/deleted-source cases, Stripe test-mode checks, and production smoke checks. Any inaccessible external environment remains explicitly unverified, and the release is not called live until production checks pass.
