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

export function validateClipEditDraft(input: unknown, clip: ClipSource): ClipEditDraftV1 {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ClipEditDraftError("Invalid edit draft.");
  }
  const draft = input as Record<string, unknown>;
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
  if (Object.prototype.hasOwnProperty.call(draft, "vertical_layout")) {
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

export function readClipEditDraft(clip: SavedClip): { draft: ClipEditDraftV1; unsupportedVersion: boolean } {
  if (!clip.edit_draft) return { draft: defaultClipEditDraft(clip), unsupportedVersion: false };
  try {
    return { draft: validateClipEditDraft(clip.edit_draft, clip), unsupportedVersion: false };
  } catch {
    return { draft: defaultClipEditDraft(clip), unsupportedVersion: true };
  }
}

/** The render service takes absolute VOD times, even when it reads an archive. */
export function toClipExportPayload(clip: SavedClip, draft: ClipEditDraftV1) {
  return {
    clip_id: clip.id,
    url: clip.url,
    start_seconds: draft.start_seconds,
    end_seconds: draft.end_seconds,
    title: draft.title,
    hook: draft.hook || undefined,
    hook_style: draft.hook_style,
    aspect_ratio: draft.aspect_ratio,
    style: draft.words?.length ? draft.caption_style : undefined,
    words: draft.words?.length ? draft.words : undefined,
    vertical_layout: draft.vertical_layout,
  };
}
