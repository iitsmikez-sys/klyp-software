# Dynamic Stream Focus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Klyp streamers switch gameplay and reaction focus inside a saved vertical clip, with optional reviewable audio/transcript suggestions and matching preview/export.

**Architecture:** Store bounded source-time focus markers in the V3 edit draft. Resolve them against kept segments into output spans. Use those spans for canvas preview, a timed FFmpeg composition, caption safe areas, and timeline controls.

**Tech Stack:** Next.js, React, TypeScript, FFmpeg, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-25-dynamic-stream-focus-design.md`

## Global Constraints

- Preserve old drafts, Free original export, current saved layout, cutaways, and audio.
- No new database migration; edit drafts are existing JSON.
- Suggestions must be optional and accurately labeled as audio/transcript hints.

## Review Focus

- Removed source ranges must not create phantom markers in output.
- At a focus boundary, preview and encoded frame should use the same mode.
- Captions crossing a boundary must remain visible in the active safe region.
- Cutaways and focus composition must remain compatible.
- Excessive or malformed markers must be rejected before FFmpeg work.

---

### Task 1: Draft contract and focus span resolver
**Files:** `lib/editor-focus.ts`, `lib/clip-edit-draft.ts`, relevant tests.
**Interfaces:** `FocusEvent`, `resolveFocusSpans(events, segments, layout)`, `focusAtOutputTime`, `suggestFocusEvents`.
- [ ] Write tests for valid/invalid markers, cut mapping, focus layout, and suggestion boundaries; watch them fail.
- [ ] Implement validation and resolver, then make tests pass.
- [ ] Commit.

### Task 2: Matching preview and export
**Files:** `lib/vertical-layout.ts`, `lib/vertical-layout-ffmpeg.ts`, `lib/captions.ts`, `components/VerticalLayoutPreview.tsx`, `app/api/clip/route.ts`, relevant tests.
**Interfaces:** timed composition spans consumed by preview and FFmpeg; caption safe resolver.
- [ ] Write FFmpeg and caption tests for before/after switches and audio; watch them fail.
- [ ] Implement timed composition and safe caption rendering, then make tests pass.
- [ ] Commit.

### Task 3: Editor controls and suggestions
**Files:** `components/ClipTimelineEditor.tsx`, `components/EditorFrameControls.tsx`, `components/EditorInspector.tsx`, `components/EditorTimeline.tsx`, CSS, relevant tests.
- [ ] Write interaction tests for add/remove/accept/undo/disabled states; watch them fail.
- [ ] Add focus controls and a timeline lane, then make tests pass.
- [ ] Commit.

### Task 4: Integration and release
- [ ] Run focused and full tests, typecheck, and a hosted preview build.
- [ ] Review the branch for security and preview/export parity; fix material findings.
- [ ] Open and merge a PR, then verify production deploy and public site health.
