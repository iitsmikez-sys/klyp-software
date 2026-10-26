# Saved Clips Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver Find Moments → Preview → Download Raw or Edit Clip → Customize → Export Edited Video.

**Architecture:** Keep the existing `/api/clip` and archived-master pipeline. Add a canonical raw request path and independent client download state. Reuse the existing timeline route for saved clips, including moments saved immediately before editing. Simplify the two saved-card surfaces and both preview surfaces around the same actions.

**Tech Stack:** Next.js 16, React, TypeScript, Supabase, FFmpeg, Playwright, Node tests.

**Spec:** `docs/superpowers/specs/2026-10-26-saved-clips-workflow.md`

## Global Constraints

- Preserve the near-black and mint design, current dashboard outside clip surfaces, existing billing for analysis and premium editing, auth, source archive and timeline editor.
- No additional Sparks for raw download; no Klyp editing layer in raw MP4.
- Do not modify existing saved editor drafts when opening a clip.

## Review Focus

- Forged raw timestamps must not download a different part of a VOD.
- Saved drafts with trims/cutaways must not affect the raw download.
- A repeat click during raw generation must not start concurrent work; a second completed click should reuse the fetched blob.
- Failed source fetches must show a retryable error without an incomplete download.
- Mobile cards and dialogs must keep actions visible; desktop dialog should avoid unnecessary scroll.

---

### Task 1: Raw moment API

**Files:** `app/api/clip/route.ts`, `lib/clip-access.ts`, related route/access tests.

- [ ] Add a failing test for canonical saved-moment raw export on Free: original start/end, no overlays, no Sparks debit.
- [ ] Add a failing test for forged times and raw independence from edit drafts.
- [ ] Implement raw-specific ownership and canonical timestamps, preserve archived-source fallback, and run tests.

### Task 2: Fresh editor state

**Files:** `lib/clip-edit-draft.ts`, `components/ClipTimelineEditor.tsx`, `components/ClipPreviewModal.tsx`, related tests.

- [ ] Test that a new timeline opens with original footage, no hook and no visible captions, while saved drafts remain intact.
- [ ] Implement a clean initial V3 draft and explicit Add Captions action using the original transcript; keep existing edit/export logic.

### Task 3: Shared raw download state and saved cards

**Files:** new `components/useRawClipDownloads.ts`, `components/SavedClips.tsx`, `app/(dashboard)/dashboard/clips/page.tsx`, shared card component and tests.

- [ ] Test loading, failure, repeat download and per-clip isolation.
- [ ] Implement raw download state independent of edited exports.
- [ ] Replace saved card layouts with compact thumbnail, metadata, Edit Clip, Download Raw and more menu.

### Task 4: Preview and unsaved results

**Files:** `components/ClipPreviewModal.tsx`, `components/ResultsClipPreviewModal.tsx`, `components/FoundClipCard.tsx`, `components/AnalyzePanel.tsx`, browser tests.

- [ ] Test action wiring to the selected clip and save-before-edit for unsaved results.
- [ ] Simplify dialogs and results cards; show raw download progress/errors and keep Watch Original secondary.
- [ ] Verify desktop/mobile layout and raw video behavior in browser.

### Task 5: Final verification and release

- [ ] Run focused tests, full test suites, typecheck and production build.
- [ ] Independently review security, billing, source immutability and responsive UI.
- [ ] Publish PR, verify preview, merge, deploy processing backend, and verify both services.
