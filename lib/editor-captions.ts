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

// Compatibility for existing single-range exports.
import type { TimedWord } from "./clips";

export const CAPTION_COLORS = ["DEFAULT", "WHITE", "YELLOW", "GREEN", "PINK"] as const;
export type CaptionColor = (typeof CAPTION_COLORS)[number];
export const CAPTION_POSITIONS = ["BOTTOM", "CENTER", "TOP"] as const;
export type CaptionPosition = (typeof CAPTION_POSITIONS)[number];
export type CaptionOptions = { color: CaptionColor; position: CaptionPosition };

export const CAPTION_HEX: Record<Exclude<CaptionColor, "DEFAULT">, string> = {
  WHITE: "#FFFFFF", YELLOW: "#FFFF00", GREEN: "#00E5A0", PINK: "#FF5DAA",
};

export function parseCaptionOptions(value: Record<string, unknown>): CaptionOptions {
  return {
    color: CAPTION_COLORS.includes(value.caption_color as CaptionColor)
      ? value.caption_color as CaptionColor : "DEFAULT",
    position: CAPTION_POSITIONS.includes(value.caption_position as CaptionPosition)
      ? value.caption_position as CaptionPosition : "BOTTOM",
  };
}

/** Text is editable, but timestamps remain those of the AI transcription. */
export function parseEditedWords(value: unknown, original: TimedWord[]): TimedWord[] {
  if (!Array.isArray(value) || value.length !== original.length || value.length > 5000) {
    throw new Error("Caption edit does not match the clip transcript.");
  }
  return value.map((item, index) => {
    const text = item?.text;
    if (typeof text !== "string" || text.length > 80 || /[\u0000-\u001f]/.test(text)) {
      throw new Error("Caption words must be 80 characters or less.");
    }
    return { ...original[index], text: text.trim() };
  });
}
