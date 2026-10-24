# Klyp P0 Launch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make existing Klyp clipping reliable, bounded, and accurately described before P1 editor work.

**Architecture:** Supabase stores durable VOD and archive job state. Railway claims jobs and runs the existing processing pipeline. Processing routes authorize source ownership and bound per-user work. The landing page describes implemented behavior.

**Tech Stack:** Next.js 16, React 19, TypeScript, Supabase/Postgres, Stripe, FFmpeg, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-23-klyp-p0-launch-design.md`

## Global Constraints

- Preserve existing clips and edit drafts.
- Apply migrations before deploying dependent processing code.
- Keep P1 features out of this branch.
- Distinguish automated verification from live third-party checks.

## Review Focus

- A processing crash after analysis but before final commit must not charge twice or hide the VOD.
- Two worker invocations for one VOD must not create duplicate clips.
- A deleted source VOD must remain previewable/exportable from archived media.
- A forged clip ID or timestamp must not authorize someone else's footage.
- A Free user must see plan claims matching actual render and expiration rules.

---

### Task 1: Durable Twitch processing

**Files:** `lib/vod-poll.ts`, `app/api/twitch/eventsub/route.ts`, `supabase/migrations/016_auto_vod_jobs.sql`, `tests/auto-vod-jobs.mjs`.

- [x] Write failing tests for failed processing, duplicate delivery, retry, cancellation, and atomic charge/save.
- [x] Run those tests and observe the expected failures.
- [x] Add a durable, claimed per-VOD job and transactional completion; only advance the stream cursor on completion.
- [x] Run focused and existing tests and typecheck.

### Task 2: Automatic clip archival

**Files:** `scripts/archive-clips.mjs`, `lib/clip-archive.ts`, new worker module, `components/AnalyzePanel.tsx`, `supabase/migrations/017_clip_archive_queue.sql`, focused tests.

- [x] Write failing database tests for queue-on-save, completion, retry, and source loss.
- [x] Run tests to confirm the failures.
- [x] Add worker-backed archival of saved clips and correct the maintenance script.
- [x] Run focused and existing tests and typecheck.

### Task 3: Processing ownership and budgets

**Files:** `app/api/analyze/route.ts`, `app/api/clip/route.ts`, `app/api/preview/route.ts`, `app/api/thumbnail/route.ts`, `app/api/duration/route.ts`, `lib/job-queue.ts`, authorization helper, focused tests.

- [x] Test source-window bounds and abusive per-user concurrency.
- [x] Bind clip processing requests to saved clips or owned analysis results; enforce per-user limits on analysis, export, preview, thumbnail, and duration, with a process-wide queue.
- [x] Run focused and existing tests and typecheck.

### Task 4: Accurate promises and billing checks

**Files:** `components/PricingSection.tsx`, `components/FAQ.tsx`, billing tests, `README.md`, `SETUP.md`.

- [x] Test the configured checkout price against the displayed monthly price.
- [x] Align plan copy with current behavior.
- [x] Run focused and existing tests and typecheck.
- [ ] Exercise Stripe test-mode events when credentials are available.

### Task 5: Release verification

**Files:** end-to-end test/checklist and any minimal fixes demonstrated by those checks.

- [ ] Exercise a real VOD through analyze, save, edit, archive, export, and failure recovery in a configured environment.
- [ ] Exercise Free and Pro billing/usage in Stripe test mode in a configured environment.
- [x] Run the local suite, typecheck, production build with placeholder public Supabase values, and production dependency audit.
