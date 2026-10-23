# Streamer Vertical Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a streamer mark gameplay, facecam, and embedded-chat regions once, preview a 9:16 composition, adjust a saved clip, and export an MP4 that matches the preview.

**Architecture:** A pure normalized-geometry planner provides one layout contract for the browser preview and FFmpeg renderer. An authenticated account endpoint stores the default in Supabase; an optional clip draft override uses the saved-editor contract from PR #9. The processing service validates all geometry and uses a full-frame fallback when layout data is absent or unsupported.

**Tech Stack:** Next.js 14, TypeScript, React, Supabase, FFmpeg, Node built-in tests.

**Spec:** `docs/superpowers/specs/2026-10-22-streamer-vertical-layout-design.md`

## Global Constraints

- Base the PR on saved-editor PR #9; do not push to `main`.
- Supply migration SQL separately for hand application in Supabase SQL editor.
- Use chat already visible in VOD frames; do not fetch or draw chat messages.
- Preserve audio, original/raw export, other aspect ratios, existing Sparks rules and source/archive fallback.
- Keep gameplay dominant and keep hook/caption text off facecam and chat panels.
- Account layout setup is available on either tier; per-clip saved overrides use the existing Pro editor.
- The after-stream batch is a later independent feature.

## Review Focus

- A 720p or 4K source with the same normalized boxes renders the same panel arrangement: Task 1 test.
- A marked facecam/chat panel is missing or too small: Task 1 test and Task 3 UI warning/fallback test.
- An old or corrupt layout is loaded: Task 2 test and Task 4 fallback test.
- A saved clip override exists while the account default changes: Task 2 precedence test.
- An archived clip is exported after trimming: Task 4 integration test verifies the original-start offset and audio.

---

## File structure

- `lib/vertical-layout.ts`: versioned layout type, strict validator and pure normalized-to-pixel panel planner.
- `lib/vertical-layout.test.ts`: coordinates, missing panels, source sizes and invalid inputs.
- `lib/vertical-layout-ffmpeg.ts`: FFmpeg filter graph built from a plan; no request or billing logic.
- `lib/vertical-layout-ffmpeg.test.ts`: filter topology and output size; optional synthetic-video render test when FFmpeg is available.
- `app/api/vertical-layout/route.ts`: authenticated GET/PUT of the account layout.
- `components/VerticalLayoutEditor.tsx`: mark source boxes from a paused frame, save account default or clip override.
- `components/VerticalLayoutPreview.tsx`: canvas composition from the shared plan.
- `app/(dashboard)/dashboard/settings/page.tsx` and `components/SavedClipEditor.tsx`: entry points for default and clip layouts.
- `lib/clip-edit-draft.ts`, `lib/clip-ui.ts`, `components/useClipExports.ts`, `components/AnalyzePanel.tsx`: carry optional overrides without breaking old drafts or immediate exports.
- `app/api/clip/route.ts`: choose composed 9:16 filter or safe fallback, preserve other formats/raw and audio.
- `supabase/migrations/014_vertical_layout.sql`: nullable versioned profile layout; manually applied after 013.

### Task 1: Geometry contract

**Files:** Create `lib/vertical-layout.ts`, `lib/vertical-layout.test.ts`.

**Interfaces:** Produces `VerticalLayoutV1` with normalized `gameplay`, optional `facecam`, optional `chat` source rectangles; `validateVerticalLayout(input: unknown): VerticalLayoutV1`; `planVerticalLayout(source: {w:number;h:number}, layout: VerticalLayoutV1 | null, output: {w:number;h:number}): VerticalLayoutPlan`. `VerticalLayoutPlan` supplies source crops and output panels for the preview and renderer, or a `full_frame` fallback.

- [ ] Write failing tests: out-of-frame/NaN/tiny boxes fail; 1280×720 and 1920×1080 inputs yield equivalent normalized panel bounds; game-only fills the canvas; one optional panel takes the lower band; two optional panels split the lower band; no layout fits the whole frame without cropping.
- [ ] Run `node --test lib/vertical-layout.test.ts` and see the expected failures.
- [ ] Implement the validator and planner. The output is 9:16. With both optional panels, gameplay uses the top 70% and facecam/chat split the lower 30%; with one optional panel, it fills the lower 30%; with neither, gameplay fills the canvas. Reserve hook/caption zones inside gameplay, not the lower panels. Source rectangles use finite normalized `x,y,w,h` with `w,h >= 0.05` and bounds within `[0,1]`.
- [ ] Rerun the test and `npx tsc --noEmit`, then commit.

### Task 2: Owner-scoped persistence and draft precedence

**Files:** Create `supabase/migrations/014_vertical_layout.sql`, `app/api/vertical-layout/route.ts`, `lib/vertical-layout-auth.ts`, `lib/vertical-layout-auth.test.ts`; modify `lib/tier.ts`, `lib/clip-edit-draft.ts`, `lib/clip-edit-draft.test.ts`.

**Interfaces:** Consumes Task 1 validator. Produces authenticated GET/PUT `/api/vertical-layout` returning `{layout: VerticalLayoutV1 | null}` and accepting the same shape; optional `vertical_layout?: VerticalLayoutV1 | null` in `ClipEditDraftV1`, where omitted/null inherits the account default and an explicit layout overrides it; `effectiveVerticalLayout(accountLayout, draftOverride)` centralizes precedence.

- [ ] Write failing auth and draft tests: anonymous rejected; owner on either tier can save without Sparks; another user cannot overwrite; invalid geometry rejected; missing/null override inherits latest account layout; explicit saved override survives account changes; old version-1 drafts validate unchanged.
- [ ] Run the focused tests to see failures.
- [ ] Add nullable `public.profiles.vertical_layout jsonb` SQL with no broad update policy, implement session-owner GET/PUT through the existing Supabase server/admin pattern, and extend draft validation/payload. Never trust a client-supplied user id.
- [ ] Rerun tests and TypeScript; commit the migration and code together.

### Task 3: Creator layout controls and exact preview

**Files:** Create `components/VerticalLayoutEditor.tsx`, `components/VerticalLayoutPreview.tsx`; modify `app/(dashboard)/dashboard/settings/page.tsx`, `components/SavedClipEditor.tsx`, `components/ClipPreviewModal.tsx`, `lib/clip-ui.ts` as needed.

**Interfaces:** Consumes Tasks 1–2. Editor accepts a source video/frame, a validated layout and save callbacks. Preview accepts the same plan plus video/frame and draws source crops into the output panels. Settings saves the account default; saved-clip editor saves an override through its existing draft endpoint.

- [ ] Write failing tests for `clampSourceRect(rect: NormalizedRect)` and `chatReadabilityWarning(rect: NormalizedRect, sourceHeight: number)`: boxes cannot leave frame, a marked chat region below 180 source pixels warns, missing optional panels remain disabled, and an unchanged clip inherits the account default.
- [ ] Run focused tests to see failures.
- [ ] Implement the region controls and canvas preview from Task 1 plan; place labels and overlays in safe zones. Wire settings and saved editor to persistence. Keep the source-aspect preview available for checking the original moment.
- [ ] Verify with TypeScript and a local visual inspection at desktop and narrow viewport; commit.

### Task 4: Composed export, fallback and pixel verification

**Files:** Create `lib/vertical-layout-ffmpeg.ts`, `lib/vertical-layout-ffmpeg.test.ts`; modify `app/api/clip/route.ts`, `components/useClipExports.ts`, `components/AnalyzePanel.tsx` and payload helpers.

**Interfaces:** Consumes Task 1 plan and Task 2 precedence. Produces `buildVerticalFilterGraph(plan, overlays): { filter: string; videoLabel: string }`. The route selects account default or explicit clip override, revalidates it, composes only non-raw 9:16 renders, then applies existing text/watermark filters and maps original audio.

- [ ] Write failing tests for two optional panels, one/no panel, bad layout fallback, unchanged other formats/raw, 2× upscale output dimensions, and archived trimmed source offset. Use a synthetic color-frame/video fixture to check rendered pixels and audio when FFmpeg is present.
- [ ] Run focused tests to see failures.
- [ ] Implement filter graph and route integration. Invalid/unsupported layout shows a clear warning to the caller and takes the full-frame fallback; a renderer failure does not replace saved data. Keep existing Sparks behavior.
- [ ] Run tests, TypeScript, `git diff --check`, production build and one end-to-end export with licensed or creator-owned footage. Commit.

### Task 5: Final integration and review

**Files:** Update spec/plan only if implementation decisions changed; no new feature code expected.

**Interfaces:** All earlier tasks together. Do not mix the after-stream review batch into this PR.

- [ ] Run the full Node test suite and TypeScript checks; rerun production build.
- [ ] Compare the same frame in browser preview and rendered MP4. Inspect gameplay payoff, facecam, chat legibility, hook/caption placement and audio. Record any limitations in the PR.
- [ ] Review the diff, open a stacked PR based on `codex/saved-clip-editor`, and attach it to this task. State that migration 014 follows migration 013 and must be run manually before deployment.
