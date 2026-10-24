# Klyp Ten Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the audit's ten improvements and release the verified set together.

**Architecture:** Build on the committed P0 reliability branch. Supabase holds owned drafts and feedback; pure editor helpers produce valid timelines and crop instructions; the processing service renders them with FFmpeg and validates finalists using bounded multimodal samples.

**Tech Stack:** Next.js 16, React 19, TypeScript, Supabase/Postgres, Stripe, AssemblyAI, Claude, FFmpeg, Node tests.

**Spec:** `docs/superpowers/specs/2026-10-23-klyp-ten-improvements-design.md`

## Global Constraints

- Preserve existing saved clips and local drafts.
- Do not copy competitor templates or assets.
- Match preview and export for each edit control.
- Apply migrations before dependent code.
- Do not publish until all ten have verified completion evidence.

## Review Focus

- A deleted source must still export an archived saved clip.
- Two devices editing the same draft must not silently overwrite recent work.
- A transcript cut must not drop words outside the selected range or misplace imported media.
- An invalid crop or caption setting must not enter an FFmpeg command.
- AI validation and feedback must respect ownership, caps, and cost limits.

---

### Task 1: P0 release evidence

**Files:** `SETUP.md`, release smoke scripts, P0 worker and migration files if a demonstrated failure requires a fix.

- [ ] Recheck Twitch job, archival, billing, and ownership tests; add a reusable authenticated real-VOD smoke script.
- [ ] Exercise Gaming, IRL, long VOD, upload, deleted-source, and Stripe test paths in an authorized environment; fix demonstrated failures red-to-green.
- [ ] Record exact external checks and remaining constraints.

### Task 2: Device-synced drafts

**Files:** new Supabase migration, draft validation/sync helper, `components/SavedClipEditor.tsx`, focused tests.

- [ ] Test ownership, valid document shape, old local-draft migration, and conflict resolution.
- [ ] Implement per-clip remote draft load/save with a visible sync state and local fallback.
- [ ] Verify cross-device reload and concurrent editing in a configured environment.

### Task 3: Manual crop and layouts

**Files:** crop helper, editor UI, preview renderer, `/api/clip`, focused FFmpeg tests.

- [ ] Test bounded crop coordinates and layout presets with real frames.
- [ ] Add manual placement controls for source/gameplay and facecam layouts.
- [ ] Render the same placement in preview and export across supported ratios.

### Task 4: Original animated captions

**Files:** caption template definitions, ASS generation, canvas preview, editor UI, tests.

- [ ] Test the template catalog, animation timing, and ASS/preview parity.
- [ ] Add a small original template set with accessible controls.
- [ ] Verify sample exports with FFmpeg.

### Task 5: Transcript cuts and silence suggestions

**Files:** editor timeline helper, transcript UI, suggestion helper, tests.

- [ ] Test word-aligned removal, silence gap suggestions, caption retiming, and imported-media placement.
- [ ] Add selection/cut and accept/dismiss controls to the editor.
- [ ] Verify exported timeline duration and audio continuity.

### Task 6: Measured candidate validation and creator feedback

**Files:** analysis pipeline, bounded frame sampler, feedback schema/API/UI, cost guards, tests.

- [ ] Test multimodal sample caps and fallback when vision fails.
- [ ] Validate finalists with sparse frames and transcript/chat signals; state score rationale without promising virality.
- [ ] Record approved/rejected/edited/downloaded signals only for owned clips and use aggregate feedback to adjust future rankings.

### Task 7: Full verification and release

**Files:** deployment runbook and any demonstrated fixes.

- [ ] Run focused tests, full tests, typecheck, production build, audit, and whole-branch review.
- [ ] Apply migrations, deploy processing and frontend in safe order, then run production smoke checks.
- [ ] Report the production URLs and evidence only when live checks pass.
