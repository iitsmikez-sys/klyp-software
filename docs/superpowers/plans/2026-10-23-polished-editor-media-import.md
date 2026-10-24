# Polished Klyp Editor and Media Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the reference-quality Klyp editor with real playable footage and saved photo/video visual cutaways that appear in the exported MP4.

**Architecture:** Keep the current saved-clip draft, source-cut, caption, layout, and FFmpeg pipelines. Add a V3 draft with source-anchored visual cutaways and private durable asset storage; use one cutaway resolver for timeline/preview/export. Rebuild the editor shell and timeline styles around those working behaviors.

**Tech Stack:** Next.js 14, React 18, TypeScript, Supabase Postgres/Storage, FFmpeg/FFprobe, Node test runner, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-23-polished-editor-media-import-design.md`

## Global Constraints

- Use the actual lowercase Klyp dashboard logo, not the stylized uppercase reference logo.
- Imported media covers stream picture; stream audio, captions, and hook continue. Imported video audio is muted.
- Cutaways are anchored to source moments: earlier ripple cuts move them earlier; deleted covered footage shortens or removes them.
- Preserve V1/V2 drafts, existing Free/Pro/format gates, ownership, and Sparks rules.
- Imported originals live in private persistent storage, never only in `CACHE_DIR`.
- Allow JPEG/PNG/WebP photos up to 10 MB, and MP4/MOV/WebM videos up to 50 MB and 60 seconds. Allow at most 12 cutaways and 180 seconds of output.
- Migrations are separate numbered SQL files for hand application; do not run a CLI migration.
- Do not spend Sparks for testing without user consent. Do not present simulated footage or controls as real.

## Review Focus

- A VOD source is gone but its clip archive exists: editor preview and export still use the archive (Task 4 test).
- A cut removes the source moment covered by an import: the insert shortens/disappears without covering unrelated video (Task 1 test).
- A user submits another creator's asset ID: save and export refuse it (Tasks 2 and 3 tests).
- An upload has a valid extension but invalid bytes or excessive size: it is rejected and cleaned up (Task 2 test).
- An import is at a source-cut boundary or the last output frame: preview and export choose the same visual and duration (Tasks 1 and 3 tests).

---

### Task 1: Versioned cutaway model and time mapping

**Files:** Modify `lib/clip-edit-draft.ts`, `lib/editor-timeline.ts`, `lib/editor-captions.ts` if required; test `lib/clip-edit-draft.test.ts`, `lib/editor-timeline.test.ts`.

**Interfaces:** Produce `ClipEditDraftV3`, `VisualCutaway`, `resolveCutawaySpans(draft: ClipEditDraftV3): ResolvedCutawaySpan[]`, and `cutawayAtOutputTime(spans: readonly ResolvedCutawaySpan[], seconds: number): ResolvedCutawaySpan | null`. Each resolved span includes asset ID, output start/end, and asset input offset. `upgradeClipEditDraft` returns V3. Retain V1/V2 read compatibility.

- [ ] Write tests: V1/V2 upgrade; three-second photo insertion; cut before insert moves it by five seconds; cut through covered moment shortens it; deletion of covered moment removes it; more than 12, overlapping, malformed, or out-of-bounds imports fail; boundary lookup chooses the next interval.
- [ ] Run `node --experimental-strip-types --test lib/clip-edit-draft.test.ts lib/editor-timeline.test.ts`; confirm new tests fail.
- [ ] Implement V3 validation and pure source-to-output cutaway resolution with stable IDs and explicit caps. Keep caption/source mapping unchanged.
- [ ] Rerun those tests and `npx tsc --noEmit`; require pass.
- [ ] Commit model and tests.

### Task 2: Durable owned asset upload

**Files:** Create `supabase/migrations/015_editor_media.sql`, `lib/editor-assets.ts`, `app/api/clips/[id]/media/route.ts`, `app/api/clips/[id]/media/[assetId]/route.ts`; test `lib/editor-assets.test.ts` and route ownership helpers. Modify `app/api/clips/[id]/edit-draft/route.ts` to validate every referenced asset.

**Interfaces:** Produce `createEditorUpload(userId, clipId, fileName, declaredSize, declaredMime)`, `finalizeEditorUpload(userId, clipId, assetId)`, `listEditorAssets(userId, clipId)`, `getOwnedEditorAsset(userId, clipId, assetId)`, and `assertOwnedDraftAssets(userId, clipId, draft)`. Asset metadata includes kind, path, duration, dimensions, and verified status. The route issues short-lived signed upload/preview URLs; only verified assets enter drafts.

- [ ] Write tests for JPEG/PNG/WebP ≤10 MB, MP4/MOV/WebM ≤50 MB and ≤60 seconds, wrong owner/clip, invalid media bytes, missing storage object, abandoned upload cleanup, and draft asset ownership.
- [ ] Run focused Node tests; confirm new tests fail.
- [ ] Add private bucket/table SQL with ownership policies and bounded metadata. Implement authenticated upload initiation, direct signed upload, server-side finalization with actual media probing, listing, short-lived preview URL, and clear missing-migration errors. Avoid buffering a large video in a Vercel route.
- [ ] Run focused tests and TypeScript; require pass. Inspect SQL before any manual application.
- [ ] Commit migration, API, and tests. Do not apply the migration automatically.

### Task 3: Export compositor for cutaways

**Files:** Create `lib/editor-cutaway-render.ts`; modify `lib/editor-render.ts`, `app/api/clip/route.ts`; test `lib/editor-cutaway-render.test.ts`, `lib/editor-render.test.ts` and an FFmpeg integration fixture test where tools are available.

**Interfaces:** Produce `buildCutawayGraph(baseVideoLabel: string, spans: readonly ResolvedCutawaySpan[], assets: readonly RenderableEditorAsset[], dimensions: { w: number; h: number }): { filter: string; videoLabel: string }`. `RenderableEditorAsset` has `{ id, localPath, kind }` plus verified dimensions/duration. Integrate the returned video label into `cutClip` after existing vertical-layout/format framing and before caption/hook filters. Add each owned media file as an FFmpeg input, but keep input 0's source audio as the output audio stream.

- [ ] Write tests for one photo, one muted video, source audio continuity, cut-boundary timing, missing/foreign asset, fit/focal crop, and no-cutaway backward compatibility. Use a short generated video/audio fixture for one rendered MP4 assertion.
- [ ] Run focused tests; confirm new tests fail.
- [ ] Add FFmpeg composition after existing source-cut concatenation and vertical framing but before caption/hook rendering. Fetch only verified owned assets, normalize frame rate and dimensions, preserve source audio, and clean temporary intermediates.
- [ ] Rerun focused tests, probe rendered fixture duration/streams, and run TypeScript; require pass.
- [ ] Commit export path and tests.

### Task 4: Browser preview and media import controls

**Files:** Create `components/EditorMediaLibrary.tsx`, `components/EditorCutawayPreview.tsx`; modify `components/ClipTimelineEditor.tsx`, `components/EditorMedia.tsx`, `components/VerticalLayoutPreview.tsx` as needed; test relevant pure helpers and Playwright interactions.

**Interfaces:** Media library calls Task 2 routes and reports verified assets; cutaway preview uses Task 1 `cutawayAtOutputTime`. The parent owns selection, upload progress, and undoable V3 draft changes; export passes V3.

- [ ] Write tests for choosing a photo/video, upload/probe progress, insertion at playhead, save/reload, remove/undo, seeking through cutaway, source-archived fallback, and an unavailable-source retry state.
- [ ] Run focused tests; confirm new tests fail.
- [ ] Add working file picker, progress, media list, cutaway selection/editing, short-lived asset URL refresh, and synchronized muted cutaway picture over the source canvas. Use real poster/loading/error states; no fabricated frames.
- [ ] Rerun tests and TypeScript; require pass.
- [ ] Commit preview and import UI.

### Task 5: Reference-quality editor shell and timeline

**Files:** Modify `components/ClipTimelineEditor.tsx`, `components/EditorTimeline.tsx`, `components/EditorTranscript.tsx`, `components/EditorInspector.tsx`, `components/clip-timeline-editor.css`; create focused presentational components if a file becomes unwieldy.

**Interfaces:** Preserve Task 4 behavior and existing accessible controls. Timeline takes resolved cutaway spans, real thumbnail and waveform data, selected item, playhead, and zoom. A cutaway is shown as a purple block in the video lane; caption and hook tracks retain their own timing.

- [ ] Capture baseline desktop and narrow-screen screenshots; write a Playwright interaction check for seek, select, split/delete, upload, save, and export control states.
- [ ] Rebuild hierarchy to match the supplied reference: authentic logo, roomy central portrait preview, readable transcript and inspector, blue video thumbnails, green captions/audio, purple hook/imports, usable 44px controls, and restrained borders. Make every visible control functional or remove it.
- [ ] Run the interaction check and capture after screenshots at desktop/narrow widths; inspect visual differences against the user's reference and revise spacing, color, typography, and button treatments.
- [ ] Run TypeScript and focused tests; require pass.
- [ ] Commit visual/editor shell changes.

### Task 6: End-to-end verification and draft PR

**Files:** Update the spec/plan checkboxes and any setup note needed to apply the migration; modify product code only for failures found.

**Interfaces:** No new public contract.

- [x] Run all Node tests and `npx tsc --noEmit`; local verification passed ([Task 6 report](../reports/2026-10-23-polished-editor-media-import-task-6-report.md)).
- [ ] Complete `npm run build` in frontend and processing configurations. Both attempts are blocked by `fonts.googleapis.com` DNS resolution (`ENOTFOUND`) while fetching DM Sans through `next/font/google`.
- [x] Verify a local synthetic MP4 through the actual export route: picture boundaries, source audio, muted imported audio, caption/hook timing, and browser file playback.
- [x] Document manual migration 015, schema/bucket inspection SQL, and service configuration in `docs/editor-media-setup.md`.
- [ ] Apply no migration by CLI. Present the SQL for manual application, then verify the installed schema/bucket once available.
- [ ] On an owned saved clip, import photo and video, save/reload, cut before insert, preview, export, and inspect rendered MP4 audio/video/caption timing and file playback. Do not start paid analysis or consume Sparks.
- [ ] Review the branch, address actionable findings, and update the draft PR with exact status, migration step, and any unverified real-clip behavior. Keep it draft until the real test passes.
