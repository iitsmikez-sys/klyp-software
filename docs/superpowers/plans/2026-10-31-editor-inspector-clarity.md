# Editor Inspector Clarity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make Klyp's editor right panel easy to understand by putting each editing task in one place.

**Architecture:** Keep the existing `EditorInspector` component and draft callbacks. Reorganize its three visible tabs into Captions, Hook, and Layout without changing export data. Reuse `CaptionTemplatePicker`, reducing its initial visible choices with a local disclosure. Keep all ten styles available.

**Tech Stack:** React, TypeScript, CSS, Playwright browser fixture.

**Spec:** `docs/superpowers/specs/2026-10-31-editor-inspector-clarity-design.md`

## Global Constraints

- Preserve draft format and export API payloads.
- Preserve all 10 caption styles, manual edits, and custom placement.
- Keep Klyp dark/mint theme and keyboard access.
- Do not deploy or change production data during implementation.

## Review Focus

- With no captions, adding them is obvious and optional.
- Switching templates does not erase manually edited cues.
- Selecting a caption opens its text and timing controls.
- Custom position is explained, and position presets clear the custom placement.
- The panel fits at desktop and narrow widths without horizontal overflow.

---

### Task 1: Captions and Hook flow

**Files:**
- Modify: `components/EditorInspector.tsx`
- Modify: `components/CaptionTemplatePicker.tsx`
- Test: `tests/editor-redesign.browser.cjs`

- [x] Update the browser fixture to expect Captions / Hook / Layout and one caption setup flow; run it to see the old UI fail.
- [x] Move caption status, selected cue editing, template picker, and fine-tuning into Captions.
- [x] Put hook text, suggestions, and styles into Hook; keep suggestions collapsed by default.
- [x] Move contextual trim into Layout; leave export and draft callbacks unchanged.
- [x] Run the browser fixture and typecheck; fix only regressions tied to this task.

### Task 2: Calm presentation and responsive check

**Files:**
- Modify: `components/clip-timeline-editor.css`
- Test: `tests/editor-redesign.browser.cjs`

- [x] Add browser assertions for the compact picker, disclosure controls, and narrow viewport overflow; run them against the old UI first.
- [x] Tighten tab spacing, status, and disclosure styling. Avoid gradients, glows, and oversized cards.
- [x] Capture desktop and mobile screenshots and visually inspect them.
- [x] Run targeted browser tests, full unit suite, and typecheck.
- [x] Review the diff, commit on the isolated branch, and create a PR based on caption PR #63.
