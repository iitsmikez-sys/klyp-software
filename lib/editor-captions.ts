import type { ClipEditDraftV2, ClipEditDraftV3 } from "./clip-edit-draft.ts";
import type { SavedClip } from "./clip-ui.ts";
import { buildCaptionCues, HOOK_DURATION_MS, normalizeTimedCues } from "./captions.ts";
import { outputSpansForSourceCue, outputDuration, type CaptionCue } from "./editor-timeline.ts";
export { captionAppearance } from "./captions.ts";

/** Source anchors remain in the draft; only this resolved view uses edited time. */
export function resolveEditorCues(draft: ClipEditDraftV2 | ClipEditDraftV3, clip: SavedClip): CaptionCue[] {
 const source = draft.caption_cues ?? buildCaptionCues(draft.words ?? clip.words ?? [], clip.start_seconds * 1000, clip.end_seconds * 1000, draft.caption_style === "KLYP" ? 1 : 4).map((cue, index) => ({ id: `auto-${index}`, text: cue.text, start_ms: cue.startMs + clip.start_seconds * 1000, end_ms: cue.endMs + clip.start_seconds * 1000 }));
 const usedIds = new Set(source.map(cue => cue.id));
 return normalizeTimedCues(source.flatMap(cue => {
  const spans = outputSpansForSourceCue(draft.segments, cue);
  return spans.map((span, index) => {
   let id = cue.id;
   if (spans.length > 1) {
    id = `${cue.id}:fragment:${index}`;
    while (usedIds.has(id)) id += ":";
    usedIds.add(id);
   }
   return { id, ...span, text: cue.text };
  });
 }));
}

/** The preview player passes edited output seconds, including after source skips. */
export function editorOverlayAtTime(draft: ClipEditDraftV2 | ClipEditDraftV3, clip: SavedClip, seconds: number) {
 const within = Number.isFinite(seconds) && seconds >= 0 && seconds < outputDuration(draft.segments);
 return { hook: within && seconds * 1000 < HOOK_DURATION_MS && draft.hook ? draft.hook : null,
 caption: within ? resolveEditorCues(draft, clip).find(cue => seconds * 1000 >= cue.start_ms && seconds * 1000 < cue.end_ms) ?? null : null };
}
