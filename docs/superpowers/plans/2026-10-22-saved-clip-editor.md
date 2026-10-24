# Saved Clip Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Pro users trim a saved clip, correct its title/hook/caption words, save those choices, and export the selected edit.

**Architecture:** Keep the analyzed clip immutable and store one versioned `edit_draft` JSON object on its row. An authenticated Next.js route validates and saves only that object. The editor previews and exports from local draft state; the processing route correctly rebases trim times for archived masters.

**Tech Stack:** Next.js 14, React 18, TypeScript, Supabase/Postgres, FFmpeg, Node 24 built-in test runner.

**Spec:** `docs/superpowers/specs/2026-10-22-saved-clip-editor-design.md`

## Global Constraints

- Keep original clip analysis fields immutable; store one nullable `edit_draft jsonb` per clip.
- Existing Edit Clip Pro gate and export tier, watermark, and Sparks rules remain.
- Save is free of Sparks; export keeps its current cost behavior.
- SQL is supplied separately for hand application in the Supabase SQL editor; never apply it with a CLI.
- No direct posting, scheduling, multitrack timeline, or missing-transcript generation in this release.
- Use a new branch and PR; do not push to main.

## Review Focus

- A draft trim ending exactly at the original end exports that final section; test both source and archived-master offset math in Task 3.
- A malicious client changes word timestamps rather than text; Task 1 tests that validation rejects it.
- The user has no timed words; Task 4 tests that trim/title/hook still work and captions stay unavailable.
- An expired source VOD has a stored archive; Task 3 tests the archived path uses the original clip start and `clip_id`.
- Save fails or the modal closes with dirty state; Task 4 tests edits remain visible and a close warning appears.

---

### Task 1: Draft type, validation, and SQL

**Files:**
- Create: `lib/clip-edit-draft.ts`
- Create: `lib/clip-edit-draft.test.ts`
- Create: `supabase/migrations/013_clip_edit_draft.sql`
- Modify: `lib/clip-ui.ts`

**Interfaces:**
- Produce: `ClipEditDraftV1` (`version: 1`, `start_seconds`, `end_seconds`, `title`, `hook`, `hook_style`, `caption_style`, `aspect_ratio`, `words: TimedWord[] | null`).
- Produce: `validateClipEditDraft(input: unknown, clip: Pick<SavedClip, "start_seconds" | "end_seconds" | "words">): ClipEditDraftV1` (throws a typed validation error).
- Produce: `defaultClipEditDraft(clip: SavedClip): ClipEditDraftV1` and `readClipEditDraft(clip: SavedClip): { draft: ClipEditDraftV1; unsupportedVersion: boolean }`; unknown versions fall back to defaults and set the warning flag.

- [ ] **Step 1: Write failing Node tests.** Assert a valid trim/text draft passes; zero/negative/over-180-second or out-of-original trim fails; unknown styles and format fail; title/hook limits fail; word count/timestamps differing from originals fail; null words on an old clip pass; future draft version falls back safely.
- [ ] **Step 2: Run `node --experimental-strip-types --test lib/clip-edit-draft.test.ts`.** Expect the missing module/functions failure.
- [ ] **Step 3: Implement the types and pure validation helpers.** Accept only `version: 1`, title length 1–120 after trim, hook length 0–80, known enum values, finite ordered trim within original range, and text-only word changes with original timestamps preserved. Add `edit_draft` to `SavedClip`.
- [ ] **Step 4: Add idempotent SQL `alter table public.clips add column if not exists edit_draft jsonb;`.** Document that production application is manual.
- [ ] **Step 5: Run the focused tests and `npx tsc --noEmit`; expect both to pass. Commit.**

### Task 2: Owned draft save/reset endpoint

**Files:**
- Create: `app/api/clips/[id]/edit-draft/route.ts`
- Create: `lib/clip-edit-auth.ts`
- Create: `lib/clip-edit-auth.test.ts`

**Interfaces:**
- Consume: `validateClipEditDraft` from Task 1.
- Produce: `authorizeClipDraftWrite(userId: string | null, ownerId: string | null, tier: string | null, subscriptionId: string | null): 401 | 403 | 404 | null`; route calls it before any update.
- Produce: `PUT /api/clips/:id/edit-draft` with `{ draft }` and `DELETE /api/clips/:id/edit-draft`; return `{ edit_draft }` after the write.

- [ ] **Step 1: Write failing auth tests for another user's clip, no session, and a Free account; assert denial.** Include an owned Pro success. Task 1 covers invalid draft payloads.
- [ ] **Step 2: Run `node --experimental-strip-types --test lib/clip-edit-auth.test.ts`; expect failure before helper implementation.**
- [ ] **Step 3: Implement authenticated session lookup, confirmed subscription check, owner-scoped row lookup/update via the existing server admin client, validation, and clear 400/401/403/404/500 responses.** Update only `edit_draft`; reset it to null.
- [ ] **Step 4: Run both focused test files and `npx tsc --noEmit`; expect pass. Commit.**

### Task 3: Archived-master trim correctness

**Files:**
- Modify: `lib/clip-archive.ts`
- Modify: `app/api/clip/route.ts`
- Create: `lib/clip-trim.ts` and `lib/clip-trim.test.ts`

**Interfaces:**
- Produce: `ArchivedClip.originalStartSeconds` from the owner-scoped clip row.
- Produce: `clipSeekRange(selectedStart: number, selectedEnd: number, sourceOffset: number): { start: number; end: number }` for FFmpeg-local time.

- [ ] **Step 1: Write failing tests for exact full range, a middle trim, a trim ending at original end, and invalid outside-archive ranges.**
- [ ] **Step 2: Run `node --experimental-strip-types --test lib/clip-trim.test.ts`; expect failure.**
- [ ] **Step 3: Implement `originalStartSeconds` lookup and use it as the archived master's source offset.** Reject requested times outside that clip's original bounds; keep source-VOD offset behavior.
- [ ] **Step 4: Run focused tests and `npx tsc --noEmit`; expect pass. Commit.**

### Task 4: Saved editor controls and persistence

**Files:**
- Modify: `components/SavedClipEditor.tsx`
- Modify: `components/ClipPreviewModal.tsx`
- Modify: `app/(dashboard)/dashboard/clips/page.tsx`
- Create: `components/ClipTrimControl.tsx`
- Create: `components/CaptionWordEditor.tsx`
- Test: `lib/clip-edit-draft.test.ts` for edit-to-export mapping; manually exercise UI in Task 5

**Interfaces:**
- Consume: `readClipEditDraft`, `defaultClipEditDraft`, and the Task 2 endpoint.
- Produce: `toClipExportPayload(clip: SavedClip, draft: ClipEditDraftV1)` in `lib/clip-edit-draft.ts`; it returns the existing `/api/clip` body including `clip_id` and current edit values.
- Produce: trim/title/hook/word/style/format controls, Save, Reset, dirty/saving/error states, and export payload using the current form values and `clip_id`.

- [ ] **Step 1: Write failing tests for draft reload/reset and export mapping: edited trim/title/hook/words reach the payload, `clip_id` is present, and an old no-word clip exports without captions.**
- [ ] **Step 2: Run focused tests; expect failure.**
- [ ] **Step 3: Build controlled trim and word-text inputs, wire them to editor draft state, and constrain preview playback to the selected range.** Show hook/caption overlays and duration; preserve timestamps and existing Pro controls.
- [ ] **Step 4: Wire Save and Reset to the Task 2 route; show server-confirmed success, inline errors, and dirty-close warning.** Keep state after failures; update parent clip state after save. Manually check dirty-close and failed-save behavior before the commit.
- [ ] **Step 5: Export with current trim/title/hook/styles/format/words and `clip_id`; retain existing tier rules.**
- [ ] **Step 6: Run focused tests, `npx tsc --noEmit`, `npm run lint`, and `npm run build`; expect pass. Commit.**

### Task 5: Release review and PR

**Files:**
- Modify: `docs/superpowers/specs/2026-10-22-saved-clip-editor-design.md` only if implementation revealed a necessary scope correction

**Interfaces:**
- Consume: all previous tasks.
- Produce: a reviewable PR and the separate migration SQL path.

- [ ] **Step 1: Manually check a timed-word clip and an old no-word clip on a safe test account; verify preview, save/reload, reset, and exported MP4 trim/text.** Do not spend the user's Sparks or touch their clips without their authorization.
- [ ] **Step 2: Review the diff for accidental changes, run the relevant tests and build once more, and check Git status.**
- [ ] **Step 3: Push the feature branch, open a PR to main, attach it to this task, and report the manual SQL application step and any unverified production behavior.**
