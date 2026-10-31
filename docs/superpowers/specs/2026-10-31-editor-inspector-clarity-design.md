# Klyp Editor Inspector Clarity

## Intent

Make the right side of Klyp's timeline editor fast to understand for a first-time streamer. Preserve the dark theme, mint brand, existing edit draft, caption rendering, layout engine, and export behavior. The goal is better ease of use, with video and editing decisions ahead of decorative controls.

## Approaches

- **Chosen: focused task panels.** Replace Text / Style / Layout with Captions / Hook / Layout. Put each task's controls together and reveal advanced choices only when requested. This is the clearest first-run experience and uses existing components.
- **Considered: polish the current tabs.** Rename labels and improve spacing but leave caption settings split across Text and Style. Less code, but keeps the main navigation problem.

## Screen behavior

### Captions

1. Heading says whether captions are on. If timed words exist but captions are off, show one obvious **Add captions** button and a sentence that captions are optional. No template promises to appear on video before captions are added.
2. When a timeline caption is selected, put its text field and timing at the top, with a clear **Selected caption** label.
3. Show the active caption template and a compact set of popular templates first. **See all 10** expands the remaining choices. Each card remains keyboard accessible and selecting a template updates the live preview and export settings.
4. A **Fine-tune captions** disclosure contains font, color, and position. Replace the confusing disabled “Custom on preview” option with a plain hint: drag the caption on the video to place it anywhere. Top / Center / Bottom choices reset a custom placement.

### Hook

1. Show hook text and its three-second duration together. Explain that hook text is optional.
2. Keep saved AI suggestions collapsed by default; show the count and expand them on demand.
3. Put hook styles here, beside the hook they style. Selecting a suggestion seeks the preview to the opening.

### Layout

Keep facecam/gameplay framing controls and 9:16 guidance. Move the contextual **Trim selected clip** disclosure here, so text editing has no video-cutting controls.

## Constraints and checks

- Do not change stored draft format, caption cue timing, or export API payloads.
- Preserve all 10 styles, manual caption edits, custom placements, disabled states, and responsive behavior.
- Verify keyboard labels, tab switching, selected caption editing, optional-caption state, and narrow width layout.
- Run targeted UI tests, typecheck, and the existing unit suite. Inspect a local browser screenshot at desktop and narrow widths. Do not claim production usability from static tests alone.
