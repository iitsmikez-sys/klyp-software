# Dynamic stream focus design

## Intent
Let a streamer keep gameplay large during a play and make the facecam large for a reaction in the same 9:16 clip. The saved layout still defines the source gameplay and facecam rectangles. Each focus change is visible on the timeline, can be edited before export, and follows its original VOD moment through cuts.

## Behavior
- Pro editor: add a `Gameplay` or `Reaction` focus change at the playhead, remove it, undo/redo it, save it in the existing JSON edit draft, and see it immediately in the portrait preview. Clips without a facecam layout retain the existing framing and explain why switching is unavailable.
- Gameplay focus uses the existing saved arrangement with gameplay at 70% and the secondary band at 30%. Reaction focus places facecam in the top 70% and gameplay in the bottom 30%; chat is omitted during reaction focus so the gameplay remains legible. The source VOD audio never changes.
- A `Suggest reaction moments` action examines the already loaded audio peaks and timed transcript. Suggestions are proposals only; a streamer accepts or ignores them. The UI describes them as audio/transcript hints, not visual AI detection.
- Focus changes are anchored to source timestamps, bounded and validated on the server, and resolved to edited output spans after trim/split/delete. Export and preview use the same spans. Old drafts continue to work with no changes.
- Captions and cutaways continue to work; captions use the active composition's safe rectangle. Nonvertical and Free original exports ignore focus changes.

## Approaches
1. Render a new file for every change, then concatenate: clear but incurs repeated encodes and larger temporary storage.
2. Build timed FFmpeg composition spans from source-anchored markers: one final export pipeline and shared preview planning. **Chosen** for Klyp's existing segment and filter graph architecture.

## Risks and checks
Limit markers to 12 to keep filter graphs bounded. Validate all timestamps and modes. Test frame colors before/after a switch, audio preservation, captions across a switch, cutaway composition, old drafts, and trim/delete mapping. A source VOD with no visible facecam cannot synthesize one.
