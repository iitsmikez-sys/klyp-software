# Klyp Timeline Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a dedicated Klyp editor matching the approved mockups, with playable vertical preview and real video/audio, caption, and hook edits that survive save and export.

**Architecture:** Extend the saved `clips.edit_draft` contract to version 2 and put source-to-output time mapping in pure TypeScript. Keep the current archived/VOD resolution and render pipeline; build an edited intermediate for multiple source spans, then apply the existing vertical layout, caption, hook, plan, and watermark rules. A dedicated dashboard page renders a synchronized preview, transcript, inspector, and multi-track timeline. The existing modal stays usable for old drafts.

**Tech Stack:** Next.js 14, React 18, TypeScript, Supabase JSONB, Node test runner, FFmpeg/FFprobe, Tailwind CSS.

**Spec:** `docs/superpowers/specs/2026-10-23-capcut-style-clip-editor-design.md`

## Global Constraints

- Base the new branch on vertical-layout PR #12, which contains saved-editor PR #9; do not push to `main`.
- Existing version-1 drafts must keep their edits and export correctly.
- `clips.edit_draft` already exists; supply separate hand-applied Supabase SQL only if another schema change is necessary.
- Editing, previewing, and media sampling spend no Sparks. Preserve existing Pro gates, Free watermark, format, and upscale rules.
- No fake controls for imported media, music, templates, brand kits, transitions, rearrangement, posting, or scheduling.
- Keep the PR draft until the browser editor and rendered MP4 have been compared using an owned clip.

## Review Focus

- A source clip with no audio still previews and exports kept video spans; Task 3's silent-fixture test covers it.
- A cut through a corrected caption preserves the retained portions at the right output times; Task 2's remapping test covers it.
- A forged edit payload outside the owned clip cannot cause out-of-range processing; Task 1's validation test and Task 3's route validation cover it.
- A failed or stale save never shows “Saved to Klyp” and never silently overwrites the visible draft; Task 5's save-state test covers it.
- A missing archive proxy or deleted VOD yields a visible retry/error without synthetic frames or waveform; Task 4's media-state test covers it.

---

### Task 1: Versioned draft and source-to-output timeline

**Files:** Modify `lib/clip-edit-draft.ts`; create `lib/editor-timeline.ts`, `lib/editor-timeline.test.ts`; extend `lib/clip-edit-draft.test.ts`; modify `app/api/clips/[id]/edit-draft/route.ts` only as needed for the new union type.

**Interfaces:** `ClipEditDraftV2` extends the version-1 choice fields with `version: 2`, ordered `segments: { id: string; start_seconds: number; end_seconds: number }[]`, `caption_cues: { id: string; start_ms: number; end_ms: number; text: string }[] | null`, `caption_color: "white" | "yellow" | "green" | "pink"`, and `caption_position: "top" | "center" | "bottom"`. Source segment seconds and cue milliseconds are absolute VOD time. Export `upgradeClipEditDraft(clip, draft): ClipEditDraftV2`, `validateClipEditDraft(input, clip): ClipEditDraftV1 | ClipEditDraftV2`, `outputDuration(segments): number`, `sourceAtOutputTime(segments, seconds): number`, `outputSpansForSourceCue(segments, cue): { start_ms: number; end_ms: number }[]`, `splitSegment(segments, id, sourceSeconds)`, `deleteSegment(segments, id)`, and `trimSegment(segments, id, start, end)`. Keep `toClipExportPayload` accepting either version.

- [ ] **Step 1: Write failing tests** for V1 upgrade retaining text/layout; split preserving duration; delete rippling time; trim selected segment; cue crossing a deleted span; rejection of reversed/overlapping/out-of-bounds segments, empty result, over-180-second output, duplicate IDs, malformed cues and colors.
- [ ] **Step 2: Run** `node --test lib/editor-timeline.test.ts lib/clip-edit-draft.test.ts` and confirm the new cases fail.
- [ ] **Step 3: Implement** the exact interfaces above. Use one canonical sorted, bounded segment list, minimum 0.1-second segment/cue, maximum 64 segments and 400 cues, and validated palette/position values. Keep version-1 serialization and export behavior intact.
- [ ] **Step 4: Run** the two test files and `npx tsc --noEmit`; confirm pass.
- [ ] **Step 5: Commit** only Task 1 files.

### Task 2: Resolved captions and appearance across preview/export

**Files:** Create `lib/editor-captions.ts`, `lib/editor-captions.test.ts`; modify `lib/captions.ts`, `components/VerticalLayoutPreview.tsx`, and `lib/clip-edit-draft.ts` payload conversion.

**Interfaces:** `resolveEditorCues(draft: ClipEditDraftV2, clip: SavedClip): { id: string; start_ms: number; end_ms: number; text: string }[]` returns output-relative cues after cuts, using original words when `caption_cues` is null. `captionAppearance(draft)` returns the shared palette color and Top/Center/Bottom safe-area anchor for browser canvas and ASS. Exports receive resolved cues rather than original absolute word times for V2.

- [ ] **Step 1: Write failing tests** for corrected text, split/deleted cue behavior, cue fragments crossing a removed span, hook anchored to the first three edited seconds, and matching canvas/ASS color and vertical anchor constants.
- [ ] **Step 2: Run** `node --test lib/editor-captions.test.ts` and confirm failure.
- [ ] **Step 3: Implement** cue resolution and appearance; add explicit timed-cue ASS generation while retaining existing word-based ASS for legacy exports. Use stable cue IDs and preserve the original transcript.
- [ ] **Step 4: Run** caption tests, existing caption/layout tests, and `npx tsc --noEmit`; confirm pass.
- [ ] **Step 5: Commit** Task 2 files.

### Task 3: Real multi-cut export

**Files:** Create `lib/editor-render.ts`, `lib/editor-render.test.ts`; modify `app/api/clip/route.ts`; adjust `lib/clip-export.ts` or `components/useClipExports.ts` only if the request contract requires it.

**Interfaces:** `renderKeptSegments(sourcePath, sourceOffsetSeconds, segments, outputPath): Promise<{ duration: number; hasAudio: boolean }>` makes a temporary edited source from the original, retaining audio where present; `validateEditorExportRequest(body, ownedClip)` obtains and validates the saved or supplied V2 draft. Existing `cutClip` consumes the edited source from zero to output duration; legacy requests retain the single-range path.

- [ ] **Step 1: Write failing pure tests** for FFmpeg filter/time arguments and server rejection of forged segment bounds. Add a small synthetic FFmpeg fixture with two colored video regions and distinct audio tones; assert cut output duration, retained frame order and retained audio tone. Add a video-only fixture.
- [ ] **Step 2: Run** `node --test lib/editor-render.test.ts` and confirm failure.
- [ ] **Step 3: Implement** one source download covering the segment envelope or use the owned archived master; pre-render kept spans with `trim/atrim`, reset timestamps, concatenate, then run existing layout/caption/hook/watermark encoding. Clean temporary files in `finally`. Verify clip ownership and draft bounds server-side before expensive work. Avoid a second Sparks charge for normal export.
- [ ] **Step 4: Run** render, draft, caption, archive/trim and existing export tests plus `npx tsc --noEmit`; confirm pass.
- [ ] **Step 5: Commit** Task 3 files.

### Task 4: Honest timeline media and playable edited preview

**Files:** Create `lib/editor-preview.ts`, `lib/editor-preview.test.ts`, `components/EditorMedia.tsx`, `components/EditorTimeline.tsx`; modify `app/api/preview/route.ts` only if an editor-specific media response is needed.

**Interfaces:** `seekEditedVideo(video, segments, outputSeconds)` maps output time to the source preview's local time. `nextPlaybackPosition(segments, sourceSeconds)` skips removed spans and reports output time. `EditorMedia` loads the existing authenticated preview once, samples actual thumbnail frames from that video, and derives actual audio peaks where supported; if waveform extraction is unavailable, show “Waveform unavailable” rather than fabricated peaks. `EditorTimeline` renders proportional video, captions, audio and hook lanes, ruler, playhead, zoom, selection and trim handles.

- [ ] **Step 1: Write failing tests** for output/source seeking, skip at a deleted gap, end-of-clip pause, thumbnail timestamp selection, silent/missing media states, and time-to-pixel scaling at two zoom levels.
- [ ] **Step 2: Run** `node --test lib/editor-preview.test.ts` and confirm failure.
- [ ] **Step 3: Implement** the preview adapter and timeline. Thumbnails come from sampled preview frames. Use browser audio decoding when supported; an unsupported codec or silent source receives the honest fallback. Keep preview audio/video in sync with output-time playhead.
- [ ] **Step 4: Run** timeline tests, `npx tsc --noEmit`, and a local browser check with a synthetic clip; confirm actual frame and audio behavior.
- [ ] **Step 5: Commit** Task 4 files.

### Task 5: Mockup-matched editor page and working controls

**Files:** Create `app/(dashboard)/dashboard/clips/[id]/edit/page.tsx`, `components/ClipTimelineEditor.tsx`, `components/EditorTranscript.tsx`, `components/EditorInspector.tsx`, `lib/editor-history.ts`, `lib/editor-history.test.ts`, `lib/editor-session.ts`, `lib/editor-session.test.ts`; modify `app/(dashboard)/dashboard/clips/page.tsx`, `components/ClipPreviewModal.tsx`, and `components/SavedClipEditor.tsx` only to link/open the dedicated editor and retain old quick controls.

**Interfaces:** The page loads the owned clip, handles unauthorized/missing clips, upgrades V1 drafts in memory, and renders the dedicated editor. Pure `editor-history.ts` exposes `apply`, `undo`, `redo`, `reset` for whole-draft snapshots; `editor-session.ts` tracks selection and confirmed/pending/failed save state. `EditorTranscript` seeks the player and searches text; `EditorInspector` edits the selected video segment, caption cue, hook and styles. `ClipTimelineEditor` owns playhead, network requests, keyboard commands, and preview composition.

- [ ] **Step 1: Write failing tests** for undo/redo of split/delete/caption/style edits, redo cleared after a new edit, selected-item delete routing, Save pending/success/error transitions, and unsaved navigation guard.
- [ ] **Step 2: Run** `node --test lib/editor-history.test.ts lib/editor-session.test.ts` and confirm failure.
- [ ] **Step 3: Implement** the wide desktop shell in the second mockup's arrangement: narrow left transcript, central vertical player, right Edit/Style inspector, bottom video/caption/audio/hook timeline. Use the first mockup for mint playhead/selection, filmstrip, and transport. All visible buttons must work; omit later-feature buttons. Keep accessible labels, focus handling, disabled states, and a compact layout for narrower screens.
- [ ] **Step 4: Run** history/timeline/draft tests, `npx tsc --noEmit`, and `npm run build` where environment permits. Compare a browser screenshot at desktop width with both reference images and correct material spacing/scale/contrast.
- [ ] **Step 5: Commit** Task 5 files.

### Task 6: End-to-end verification and draft PR

**Files:** Add or adjust focused integration tests under `tests/`; update `README.md` only if release setup changes; no SQL migration unless a schema change is introduced.

**Interfaces:** Verify a saved V1 clip opens as V2, trim/split/delete/caption/style edits save and reload, and a rendered MP4 matches the preview's timing and overlays. The PR base is PR #12's branch.

- [ ] **Step 1: Run** all relevant `node --test` suites, `npx tsc --noEmit`, and `npm run build` (or record an environmental build block).
- [ ] **Step 2: Run** a synthetic FFmpeg clip through preview and export, probe duration/audio, inspect representative frames, and test broken media/error states.
- [ ] **Step 3: Review** the branch diff for fake controls, token/secret leaks, accidental `.next-verification` files, migrations, and changes to payment/Sparks rules.
- [ ] **Step 4: Push** only `codex/capcut-style-editor`, open a draft PR targeting PR #12's branch, and attach the PR to this task. Do not merge or push main.
- [ ] **Step 5: Report** passed checks, exact PR URL, and the remaining owned-clip browser/render comparison before release.
