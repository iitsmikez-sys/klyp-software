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

/* ── Caption cue timing ──────────────────────────────────────────────
 * Shared by the ASS burn (generateAss) and the preview canvas overlay
 * (ClipPreview) so what you see is exactly what gets burned. */

/** Max words per cue — small groups, TikTok/CapCut style. */
export const CUE_MAX_WORDS = 4;
/** A cue disappears this long after it appears (unless the next cue starts first). */
export const CUE_HOLD_MS = 1500;
/** Show cues slightly early to compensate for perception delay. */
export const CUE_LEAD_MS = 50;
/** A silence gap longer than this starts a new cue, so words never appear before they're spoken. */
const CUE_GAP_SPLIT_MS = 800;

export type CaptionCue = { text: string; startMs: number; endMs: number };

/**
 * Group word timestamps into display cues. Times in the result are
 * clip-relative milliseconds.
 *
 * Rules:
 *  - a cue is triggered by its first word's start_time (minus CUE_LEAD_MS)
 *  - max `maxWords` words per cue; a >800ms silence gap also splits, so a
 *    group never shows words long before they're actually said
 *  - a cue ends after CUE_HOLD_MS, when the next cue starts, or at the clip
 *    end — whichever comes first
 */
export function buildCaptionCues(
  words: TimedWord[],
  clipStartMs: number,
  clipEndMs: number,
  maxWords: number = CUE_MAX_WORDS
): CaptionCue[] {
  const inRange = words.filter((w) => w.start >= clipStartMs - 200 && w.start < clipEndMs);
  if (inRange.length === 0) return [];

  const groups: TimedWord[][] = [];
  let current: TimedWord[] = [];
  for (const w of inRange) {
    const splitOnGap = current.length > 0 && w.start - current[current.length - 1].end > CUE_GAP_SPLIT_MS;
    if (current.length >= maxWords || splitOnGap) {
      groups.push(current);
      current = [];
    }
    current.push(w);
  }
  if (current.length > 0) groups.push(current);

  const clipLenMs = clipEndMs - clipStartMs;
  const cues: CaptionCue[] = groups.map((g) => ({
    text: g.map((w) => w.text).join(" "),
    startMs: Math.max(0, g[0].start - clipStartMs - CUE_LEAD_MS),
    endMs: 0,
  }));
  cues.forEach((cue, i) => {
    const nextStart = i + 1 < cues.length ? cues[i + 1].startMs : Infinity;
    cue.endMs = Math.min(cue.startMs + CUE_HOLD_MS, nextStart, clipLenMs);
  });
  return cues.filter((c) => c.endMs > c.startMs);
}

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

  // KLYP shows one word at a time; other styles show small word groups.
  const cues = buildCaptionCues(words, clipStartMs, clipEndMs, style === "KLYP" ? 1 : CUE_MAX_WORDS);
  for (const cue of cues) {
    const text = sanitizeAssText(style === "KLYP" ? cue.text.toUpperCase() : cue.text);
    sections.push(dialogue(cue.startMs, cue.endMs, text));
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
