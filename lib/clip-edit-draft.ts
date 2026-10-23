import { resolveEditorCues } from "./editor-captions.ts";
import { validateSegments, type SourceSegment, type CaptionCue } from "./editor-timeline.ts";
import { CAPTION_STYLES, EXPORT_FORMATS, type CaptionStyle, type ExportFormat, type TimedWord } from "./clips.ts";
import { HOOK_STYLES, type HookStyle } from "./captions.ts";
import type { SavedClip } from "./clip-ui.ts";
import { validateVerticalLayout, type VerticalLayoutV1 } from "./vertical-layout.ts";

export type ClipEditDraftV1 = {
  version: 1;
  start_seconds: number;
  end_seconds: number;
  title: string;
  hook: string;
  hook_style: HookStyle;
  caption_style: CaptionStyle;
  aspect_ratio: ExportFormat;
  words: TimedWord[] | null;
  vertical_layout?: VerticalLayoutV1 | null;
};

export type ClipEditDraftV2 = Omit<ClipEditDraftV1, "version"> & {
 version: 2; segments: SourceSegment[]; caption_cues: CaptionCue[] | null;
 caption_color: "white" | "yellow" | "green" | "pink";
 caption_position: "top" | "center" | "bottom";
};
export type ClipEditDraft = ClipEditDraftV1 | ClipEditDraftV2;
export class ClipEditDraftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClipEditDraftError";
  }
}

type ClipSource = Pick<SavedClip, "start_seconds" | "end_seconds" | "words">;

export function defaultClipEditDraft(clip: SavedClip): ClipEditDraftV1 {
  return {
    version: 1,
    start_seconds: clip.start_seconds,
    end_seconds: clip.end_seconds,
    title: clip.title,
    hook: clip.hooks?.[0] ?? "",
    hook_style: "IMPACT",
    caption_style: "BOLD",
    aspect_ratio: "9:16",
    words: clip.words?.length ? clip.words.map((word) => ({ ...word })) : null,
  };
}

export function validateClipEditDraft(input: unknown, clip: ClipSource): ClipEditDraft {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ClipEditDraftError("Invalid edit draft.");
  }
  const draft = input as Record<string, unknown>;
  if (draft.version === 2) return validateV2(draft, clip);
  if (draft.version !== 1) throw new ClipEditDraftError("Unsupported edit draft version.");
  const start = draft.start_seconds;
  const end = draft.end_seconds;
  if (typeof start !== "number" || typeof end !== "number" ||
      !Number.isFinite(start) || !Number.isFinite(end) ||
      start < clip.start_seconds || end > clip.end_seconds || end <= start || end - start > 180) {
    throw new ClipEditDraftError("Trim must be within the original clip and at most 3 minutes long.");
  }
  if (typeof draft.title !== "string" || !draft.title.trim() || draft.title.trim().length > 120) {
    throw new ClipEditDraftError("Title must be 1–120 characters.");
  }
  if (typeof draft.hook !== "string" || draft.hook.length > 80) {
    throw new ClipEditDraftError("Hook must be at most 80 characters.");
  }
  if (!(HOOK_STYLES as readonly unknown[]).includes(draft.hook_style) ||
      !(CAPTION_STYLES as readonly unknown[]).includes(draft.caption_style) ||
      !(EXPORT_FORMATS as readonly unknown[]).includes(draft.aspect_ratio)) {
    throw new ClipEditDraftError("Unknown caption, hook, or export style.");
  }

  const originalWords = clip.words?.length ? clip.words : null;
  let verticalLayout: VerticalLayoutV1 | null | undefined;
  if (draft.vertical_layout !== undefined) {
    if (draft.vertical_layout === null) verticalLayout = null;
    else {
      try { verticalLayout = validateVerticalLayout(draft.vertical_layout); }
      catch { throw new ClipEditDraftError("Invalid vertical layout."); }
    }
  }
  const editedWords = draft.words;
  if (originalWords === null) {
    if (editedWords !== null) throw new ClipEditDraftError("This clip has no timed caption words.");
  } else {
    if (!Array.isArray(editedWords) || editedWords.length !== originalWords.length) {
      throw new ClipEditDraftError("Caption words must retain their original timing.");
    }
    for (let i = 0; i < originalWords.length; i++) {
      const word = editedWords[i];
      if (!word || typeof word !== "object" ||
          typeof word.text !== "string" || !word.text.trim() || word.text.length > 80 ||
          word.start !== originalWords[i].start || word.end !== originalWords[i].end) {
        throw new ClipEditDraftError("Caption corrections may change text but not word timing.");
      }
    }
  }

  return {
    version: 1,
    start_seconds: start,
    end_seconds: end,
    title: draft.title.trim(),
    hook: draft.hook.trim(),
    hook_style: draft.hook_style as HookStyle,
    caption_style: draft.caption_style as CaptionStyle,
    aspect_ratio: draft.aspect_ratio as ExportFormat,
    words: originalWords ? (editedWords as TimedWord[]).map((w) => ({ text: w.text.trim(), start: w.start, end: w.end })) : null,
    ...(verticalLayout !== undefined ? { vertical_layout: verticalLayout } : {}),
  };
}

export function readClipEditDraft(clip: SavedClip): { draft: ClipEditDraft; unsupportedVersion: boolean } {
  if (!clip.edit_draft) return { draft: defaultClipEditDraft(clip), unsupportedVersion: false };
  try {
    return { draft: validateClipEditDraft(clip.edit_draft, clip), unsupportedVersion: false };
  } catch {
    return { draft: defaultClipEditDraft(clip), unsupportedVersion: true };
  }
}

/** The render service takes absolute VOD times, even when it reads an archive. */
export function toClipExportPayload(clip: SavedClip, draft: ClipEditDraft) {
  return {
    ...(draft.version === 2 ? { edit_draft: draft, segments: draft.segments, caption_cues: draft.caption_cues, caption_color: draft.caption_color, caption_position: draft.caption_position } : {}),
    clip_id: clip.id,
    url: clip.url,
    start_seconds: draft.start_seconds,
    end_seconds: draft.end_seconds,
    title: draft.title,
    hook: draft.hook || undefined,
    hook_style: draft.hook_style,
    aspect_ratio: draft.aspect_ratio,
    style: (draft.version === 2 ? resolveEditorCues(draft, clip).length : draft.words?.length) ? draft.caption_style : undefined,
    words: draft.words?.length ? draft.words : undefined,
    vertical_layout: draft.vertical_layout,
  };
}

function validateV2(input: Record<string, unknown>, clip: ClipSource): ClipEditDraftV2 {
 let segments: SourceSegment[];
 try { segments = validateSegments(input.segments, clip.start_seconds, clip.end_seconds); }
 catch (error) { throw new ClipEditDraftError((error as Error).message); }
 const start = segments[0].start_seconds, end = segments[segments.length - 1].end_seconds;
 if (input.start_seconds !== start || input.end_seconds !== end) throw new ClipEditDraftError("Trim must match the kept segment envelope.");
 // The single-range duration rule must not count removed spans.
 const common = validateClipEditDraft({ ...input, version: 1, start_seconds: start, end_seconds: Math.min(end, start + 180) }, clip) as ClipEditDraftV1;
 if (!["white", "yellow", "green", "pink"].includes(input.caption_color as string) || !["top", "center", "bottom"].includes(input.caption_position as string)) throw new ClipEditDraftError("Invalid caption appearance.");
 let cues: CaptionCue[] | null = null;
 if (input.caption_cues !== null) {
  if (!Array.isArray(input.caption_cues) || input.caption_cues.length > 400) throw new ClipEditDraftError("Keep at most 400 caption cues.");
  const ids = new Set<string>(); let previousStart = -Infinity;
  cues = input.caption_cues.map((cue: CaptionCue) => {
   if (!cue || typeof cue.id !== "string" || !cue.id.trim() || cue.id.length > 120 || ids.has(cue.id) || !Number.isFinite(cue.start_ms) || !Number.isFinite(cue.end_ms) || cue.start_ms < clip.start_seconds * 1000 || cue.end_ms > clip.end_seconds * 1000 || cue.end_ms - cue.start_ms < 100 || cue.start_ms < previousStart || typeof cue.text !== "string" || !cue.text.trim() || cue.text.length > 1000) throw new ClipEditDraftError("Invalid caption cue.");
   ids.add(cue.id); previousStart = cue.start_ms;
   return { id: cue.id, start_ms: cue.start_ms, end_ms: cue.end_ms, text: cue.text.trim() };
  });
 }
 return { ...common, version: 2, start_seconds: start, end_seconds: end, segments, caption_cues: cues, caption_color: input.caption_color as ClipEditDraftV2["caption_color"], caption_position: input.caption_position as ClipEditDraftV2["caption_position"] };
}
export function upgradeClipEditDraft(clip: ClipSource, draft: ClipEditDraft): ClipEditDraftV2 {
 if (draft.version === 2) return validateClipEditDraft(draft, clip) as ClipEditDraftV2;
 return validateClipEditDraft({ ...draft, version: 2, segments: [{ id: "segment-1", start_seconds: draft.start_seconds, end_seconds: draft.end_seconds }], caption_cues: null, caption_color: draft.caption_style === "KLYP" ? "green" : "white", caption_position: "bottom" }, clip) as ClipEditDraftV2;
}
