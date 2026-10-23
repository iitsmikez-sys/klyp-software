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
