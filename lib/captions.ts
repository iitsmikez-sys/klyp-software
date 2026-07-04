/**
 * ASS subtitle generation for Klyp caption burn-in.
 *
 * ASS colours are ABGR hex: &HAABBGGRR
 *   white  = &H00FFFFFF
 *   black  = &H00000000
 *   green  = &H00A0E500  (#00E5A0 → B=A0, G=E5, R=00)
 *
 * PlayRes matches the output crop (default 1080×1920, 9:16 vertical). Font
 * sizes are authored against a 1920-tall frame and scaled by PlayResY so
 * captions look the same relative size in 1:1 and 16:9 exports.
 */
import type { TimedWord, CaptionStyle } from "./clips";

export type PlayRes = { w: number; h: number };
const DEFAULT_RES: PlayRes = { w: 1080, h: 1920 };
const WORDS_PER_CUE = 4;

/** ASS timestamp: H:MM:SS.cc (centiseconds, not milliseconds). */
function assTime(ms: number): string {
  const t = Math.max(0, Math.round(ms));
  const cs = Math.floor((t % 1000) / 10);
  const s = Math.floor(t / 1000) % 60;
  const m = Math.floor(t / 60000) % 60;
  const h = Math.floor(t / 3600000);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function assHeader(res: PlayRes): string {
  return `[Script Info]
ScriptType: v4.00+
WrapStyle: 0
PlayResX: ${res.w}
PlayResY: ${res.h}
ScaledBorderAndShadow: yes`;
}

const STYLES_FORMAT =
  "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding";

/**
 * Caption style parameters at the reference 1080×1920 resolution.
 * Alignment 2 = bottom-center.
 */
const STYLE_PARAMS: Record<
  CaptionStyle,
  { fontSize: number; color: string; bold: 0 | 1; outline: number; shadow: number }
> = {
  // Large white Impact-style text, heavy black outline — classic TikTok.
  BOLD: { fontSize: 82, color: "&H00FFFFFF", bold: 1, outline: 4, shadow: 0 },
  // Smaller text, 2px outline, 1px drop shadow — clean and readable.
  CLEAN: { fontSize: 58, color: "&H00FFFFFF", bold: 0, outline: 2, shadow: 1 },
  // Single word per cue, green (#00E5A0), heavy outline — Klyp branded.
  KLYP: { fontSize: 82, color: "&H00A0E500", bold: 1, outline: 4, shadow: 0 },
};

function styleBlock(style: CaptionStyle, res: PlayRes): string {
  const p = STYLE_PARAMS[style];
  const scale = res.h / DEFAULT_RES.h;
  const size = Math.round(p.fontSize * scale);
  const outline = Math.max(1, Math.round(p.outline * scale));
  const marginV = Math.round(80 * scale);
  return [
    "[V4+ Styles]",
    STYLES_FORMAT,
    `Style: Default,Arial,${size},${p.color},&H00FFFFFF,&H00000000,&H00000000,${p.bold},0,0,0,100,100,0,0,1,${outline},${p.shadow},2,10,10,${marginV},1`,
  ].join("\n");
}

const EVENTS_HEADER =
  "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text";

/** Strip characters that would open ASS override blocks or break lines. */
function sanitizeAssText(text: string): string {
  return text.replace(/[{}\\]/g, "").replace(/\r?\n/g, " ").trim();
}

/**
 * Build a Dialogue line from ASS-component parts.
 * `startMs` / `endMs` are already relative to the clip's start (0-based).
 */
function dialogue(startMs: number, endMs: number, text: string, style = "Default"): string {
  return `Dialogue: 0,${assTime(startMs)},${assTime(endMs)},${style},,0,0,0,,${text}`;
}

/**
 * Generate an ASS subtitle file content string for one clip.
 *
 * @param words        Word timestamps for this clip (milliseconds, VOD-absolute).
 * @param clipStartMs  The clip's start in ms (used to convert to clip-relative time).
 * @param clipEndMs    The clip's end in ms (words past this point are ignored).
 * @param style        Caption style preset.
 * @param res          Output resolution (defaults to 1080×1920).
 */
export function generateAss(
  words: TimedWord[],
  clipStartMs: number,
  clipEndMs: number,
  style: CaptionStyle,
  res: PlayRes = DEFAULT_RES
): string {
  const sections = [assHeader(res), "", styleBlock(style, res), "", EVENTS_HEADER];

  // Only words that start within the clip window.
  const inRange = words.filter(
    (w) => w.start >= clipStartMs - 200 && w.start < clipEndMs
  );

  if (inRange.length > 0) {
    if (style === "KLYP") {
      // One word at a time, in green, center bottom.
      for (const w of inRange) {
        const relStart = w.start - clipStartMs;
        const relEnd = Math.min(w.end, clipEndMs) - clipStartMs;
        sections.push(dialogue(relStart, relEnd, sanitizeAssText(w.text).toUpperCase()));
      }
    } else {
      // Group into chunks of WORDS_PER_CUE.
      for (let i = 0; i < inRange.length; i += WORDS_PER_CUE) {
        const group = inRange.slice(i, i + WORDS_PER_CUE);
        const relStart = group[0].start - clipStartMs;
        const relEnd = Math.min(group.at(-1)!.end, clipEndMs) - clipStartMs;
        const text = sanitizeAssText(group.map((w) => w.text).join(" "));
        sections.push(dialogue(relStart, relEnd, text));
      }
    }
  }

  return sections.join("\n");
}

/** How long the hook title stays on screen at the start of a clip. */
export const HOOK_DURATION_MS = 3000;

/** Hook text style presets — CapCut-style looks. Fonts must exist on the server. */
export const HOOK_STYLES = ["CLASSIC", "IMPACT", "YELLOW", "BOXED", "NEON", "TYPEWRITER"] as const;
export type HookStyle = (typeof HOOK_STYLES)[number];

/**
 * Hook style parameters at the reference 1080×1920 resolution.
 * borderStyle 1 = outline+shadow, 3 = opaque box (fill = OutlineColour).
 */
const HOOK_STYLE_PARAMS: Record<
  HookStyle,
  { font: string; fontSize: number; color: string; bold: 0 | 1; outline: number; borderStyle: 1 | 3 }
> = {
  // Bold white, heavy black outline — the classic TikTok hook.
  CLASSIC: { font: "Arial", fontSize: 72, color: "&H00FFFFFF", bold: 1, outline: 4, borderStyle: 1 },
  // Impact font, extra-heavy outline — meme/top-text energy.
  IMPACT: { font: "Impact", fontSize: 78, color: "&H00FFFFFF", bold: 0, outline: 5, borderStyle: 1 },
  // Yellow Arial Black — the "subtitle yellow" CapCut preset.
  YELLOW: { font: "Arial Black", fontSize: 66, color: "&H0000FFFF", bold: 1, outline: 4, borderStyle: 1 },
  // White text on a solid black box — news-banner style.
  BOXED: { font: "Arial", fontSize: 64, color: "&H00FFFFFF", bold: 1, outline: 14, borderStyle: 3 },
  // Klyp green (#00E5A0) — branded neon look.
  NEON: { font: "Arial", fontSize: 72, color: "&H00A0E500", bold: 1, outline: 4, borderStyle: 1 },
  // Courier New — typewriter/documentary caption look.
  TYPEWRITER: { font: "Courier New", fontSize: 62, color: "&H00FFFFFF", bold: 1, outline: 3, borderStyle: 1 },
};

/**
 * Generate an ASS file that burns the selected hook as a big top-center title
 * for the first few seconds of the clip (Alignment 8 = top-center).
 */
export function generateHookAss(
  hook: string,
  res: PlayRes = DEFAULT_RES,
  style: HookStyle = "CLASSIC"
): string {
  const p = HOOK_STYLE_PARAMS[style];
  const scale = res.h / DEFAULT_RES.h;
  const size = Math.round(p.fontSize * scale);
  const outline = Math.max(1, Math.round(p.outline * scale));
  const marginV = Math.round(160 * scale);
  const hookStyle = [
    "[V4+ Styles]",
    STYLES_FORMAT,
    `Style: Hook,${p.font},${size},${p.color},${p.color},&H00000000,&H00000000,${p.bold},0,0,0,100,100,0,0,${p.borderStyle},${outline},0,8,40,40,${marginV},1`,
  ].join("\n");

  return [
    assHeader(res),
    "",
    hookStyle,
    "",
    EVENTS_HEADER,
    dialogue(0, HOOK_DURATION_MS, sanitizeAssText(hook).toUpperCase(), "Hook"),
  ].join("\n");
}

/**
 * Convert a filesystem path to the form FFmpeg's `subtitles` filter accepts on
 * Windows: forward slashes + escaped drive-letter colon (`C\:`).
 */
export function toFfmpegPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^([A-Za-z]):/, "$1\\:");
}
