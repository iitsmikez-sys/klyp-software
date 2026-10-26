# Product-first Dashboard and Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Klyp's dashboard and full timeline editor a calmer, clearer visual hierarchy without changing product behavior.

**Architecture:** Restyle the existing React components and editor CSS. Preserve the VOD form, result cards, account controls, editor panels, timeline, and all event handlers. Use the existing design tokens where practical; scope editor styling under `.clip-editor`.

**Tech Stack:** Next.js 14, React 18, Tailwind CSS, existing editor CSS modules and stylesheet.

**Spec:** `docs/superpowers/specs/2026-10-25-product-first-dashboard-editor-design.md`

## Global Constraints

- No new features, dependencies, payment or Sparks changes.
- Preserve all existing actions, form labels, keyboard shortcuts, Pro gates, save state, and export requests.
- Keep the legacy saved-clip editor functional; this visual pass targets the dashboard and full timeline editor.
- Keep keyboard focus visible, reduced motion respected, and inspector reachable by scrolling on phones.
- Do not deploy. Distinguish local visual checks from hosted behavior.

## Review Focus

- At 1280px and 390px widths, the VOD input, cost, and submit action must all remain visible and usable.
- With results present, clip thumbnails, Keep, Preview, and Export must remain easy to find.
- The editor preview must remain dominant while inspector controls and timeline tracks remain legible.
- At mobile width, Transcript/Media switching and inspector scrolling must work.
- Keyboard focus and selected states must remain visible against neutral surfaces.

---

### Task 1: Dashboard work area

**Files:**
- Modify: `app/(dashboard)/dashboard/page.tsx`
- Modify: `components/AnalyzePanel.tsx`
- Modify: `components/ConnectStreamBanner.tsx`
- Modify: `components/DashboardStats.tsx`
- Modify: `components/SavedClips.tsx`

**Interface:** Existing component props and event handlers stay unchanged.

- [ ] Inspect the current dashboard locally at desktop and mobile widths; record the layout problems in the working notes.
- [ ] Restyle the page hierarchy: VOD work area first, quieter stream status, subordinate stats and saved clips. Reduce competing borders/glows, align spacing and type, retain Sparks cost visibility.
- [ ] Check URL and upload modes, cost details, disabled states, results, and saved clips at desktop and mobile widths. Fix any visual regression found.
- [ ] Run TypeScript and relevant existing tests; commit the dashboard changes.

### Task 2: Full timeline editor

**Files:**
- Modify: `components/clip-timeline-editor.css`
- Modify: `components/EditorWorkspace.module.css`
- Modify: `components/ClipTimelineEditor.tsx` only if class structure or status placement needs it
- Modify: `components/EditorInspector.tsx`, `components/EditorTimeline.tsx`, `components/EditorTranscript.tsx`, `components/EditorMediaLibrary.tsx` only for necessary visual grouping or readable labels

**Interface:** Preserve all editor callbacks, draft and save logic, Pro checks, timeline data, and export payloads.

- [ ] Inspect the current editor layout at desktop and mobile widths with a local saved-clip fixture or existing test harness.
- [ ] Simplify surfaces and decorative effects; strengthen preview, timeline, header save/export, and inspector group hierarchy. Keep distinct timeline track and selected states.
- [ ] Check preview, tabs, inspector scroll, trim selection, save and export controls, focus, and reduced motion at desktop and mobile widths. Fix any visual regression found.
- [ ] Run TypeScript and relevant existing tests; commit the editor changes.

### Task 3: Final review

**Files:** No new product files planned.

- [ ] Compare before/after screenshots for dashboard and editor at desktop and mobile widths against the spec.
- [ ] Run `git diff --check`, TypeScript, and relevant tests once on the final branch.
- [ ] Review the diff for accidental behavior or claim changes. Report what was verified locally and what remains unverified live.
