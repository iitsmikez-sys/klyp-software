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
import type { CaptionOptions } from "./editor-captions";
import type { CaptionFont } from "./clip-edit-draft.ts";
import type { TextPlacement } from "./text-placement.ts";
import { captionAssMotion, captionAssMotionAt } from "./caption-template-motion.ts";
import type { TimedWord, CaptionStyle } from "./clips";

export type PlayRes = { w: number; h: number };
const DEFAULT_RES: PlayRes = { w: 1080, h: 1920 };

/* ── Caption cue timing ──────────────────────────────────────────────
 * Shared by the ASS burn (generateAss) and the preview canvas overlay
 * (ClipPreview) so what you see is exactly what gets burned. */

/** Max words per cue — small groups, TikTok/CapCut style. */
export const CUE_MAX_WORDS = 4;
export const HOOK_TOP_MARGIN_REF = 260;
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
  // Rapid or overlapping words can create cues shorter than the editor's
  // 100 ms minimum. Keep their text by folding them into a neighbor instead
  // of dropping words or generating a draft that cannot be saved.
  for (let i = 0; i < cues.length; i++) {
    if (cues[i].endMs - cues[i].startMs >= 100) continue;
    if (i + 1 < cues.length) {
      cues[i + 1].text = `${cues[i].text} ${cues[i + 1].text}`;
      cues[i + 1].startMs = cues[i].startMs;
      cues.splice(i, 1);
      i--;
    } else if (i > 0) {
      cues[i - 1].text += ` ${cues[i].text}`;
      cues[i - 1].endMs = Math.max(cues[i - 1].endMs, cues[i].endMs);
      cues.splice(i, 1);
      i--;
    } else if (clipLenMs >= 100) {
      cues[i].startMs = Math.max(0, Math.min(cues[i].startMs, clipLenMs - 100));
      cues[i].endMs = Math.max(cues[i].endMs, cues[i].startMs + 100);
    }
  }
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
  { fontSize: number; color: string; bold: 0 | 1; italic?: 0 | 1; outline: number; shadow: number }
> = {
  // Large white Impact-style text, heavy black outline — classic TikTok.
  BOLD: { fontSize: 82, color: "&H00FFFFFF", bold: 1, outline: 4, shadow: 0 },
  // Smaller text, 2px outline, 1px drop shadow — clean and readable.
  CLEAN: { fontSize: 58, color: "&H00FFFFFF", bold: 0, outline: 2, shadow: 1 },
  // Single word per cue, green (#00E5A0), heavy outline — Klyp branded.
  KLYP: { fontSize: 82, color: "&H00A0E500", bold: 1, outline: 4, shadow: 0 },
  PULSE: { fontSize: 78, color: "&H0000FFFF", bold: 1, outline: 5, shadow: 0 },
  SLIDE: { fontSize: 68, color: "&H00FFFFFF", bold: 1, outline: 3, shadow: 1 },
  SPARK: { fontSize: 88, color: "&H00A0E500", bold: 1, outline: 5, shadow: 0 },
  BOUNCE: { fontSize: 82, color: "&H00FFFFFF", bold: 1, outline: 6, shadow: 0 },
  GLOW: { fontSize: 72, color: "&H00FF99FF", bold: 1, outline: 3, shadow: 7 },
  COMIC: { fontSize: 76, color: "&H0000DFFF", bold: 1, italic: 1, outline: 7, shadow: 2 },
  KEYWORD: { fontSize: 66, color: "&H00FFFFFF", bold: 1, outline: 5, shadow: 1 },
};

const FONT_NAMES: Record<CaptionFont, { ass: string; css: string }> = {
  sans: { ass: "DejaVu Sans", css: '"DejaVu Sans", Arial, sans-serif' },
  serif: { ass: "DejaVu Serif", css: '"DejaVu Serif", Georgia, serif' },
  mono: { ass: "DejaVu Sans Mono", css: '"DejaVu Sans Mono", monospace' },
};
export const captionFontFamily = (font: CaptionFont = "sans") => FONT_NAMES[font].css;

function styleBlock(style: CaptionStyle, res: PlayRes, bottomInset = 0, options?: CaptionOptions, font?: CaptionFont, textScale = 1): string {
  const p = STYLE_PARAMS[style];
  const scale = res.h / DEFAULT_RES.h;
  const size = Math.round(p.fontSize * scale * textScale);
  const outline = Math.max(1, Math.round(p.outline * scale * textScale));
  const position = options?.position ?? 'BOTTOM';
  const marginV = position === 'CENTER' ? 0 : Math.round((position === 'TOP' ? 400 : 80) * scale + (position === 'BOTTOM' ? bottomInset : 0));
  const alignment = position === 'TOP' ? 8 : position === 'CENTER' ? 5 : 2;
  const colors = { WHITE: '#FFFFFF', YELLOW: '#FFFF00', GREEN: '#00E5A0', PINK: '#FF5DAA' };
  const hex = style !== 'COMIC' && style !== 'KEYWORD' && options?.color && options.color !== 'DEFAULT' ? colors[options.color] : null;
  const color = hex ? '&H00' + hex.slice(5,7) + hex.slice(3,5) + hex.slice(1,3) : p.color;
  return [
    "[V4+ Styles]",
    STYLES_FORMAT,
    `Style: Default,${font ? FONT_NAMES[font].ass : "Arial"},${size},${color},&H00FFFFFF,&H00000000,&H00000000,${p.bold},${p.italic ?? 0},0,0,100,100,0,0,1,${outline},${p.shadow},${alignment},10,10,${marginV},1`,
  ].join("\n");
}

const EVENTS_HEADER =
  "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text";

/** Strip characters that would open ASS override blocks or break lines. */
function sanitizeAssText(text: string): string {
  return text.replace(/[{}\\]/g, "").replace(/\r?\n/g, " ").trim();
}

/** Fixed line breaks keep the browser preview and ASS export in the same safe area. */
export function wrapCaptionText(text: string, style: CaptionStyle, characterLimit = style === "CLEAN" ? 28 : 20): string[] {
  const limit = characterLimit;
  const lines: string[] = [];
  let line = "";
  for (const word of text.trim().split(/\s+/)) {
    if (line && `${line} ${word}`.length > limit) { lines.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Build a Dialogue line from ASS-component parts.
 * `startMs` / `endMs` are already relative to the clip's start (0-based).
 */
function dialogue(startMs: number, endMs: number, text: string, style = "Default", layer = 0): string {
  return `Dialogue: ${layer},${assTime(startMs)},${assTime(endMs)},${style},,0,0,0,,${text}`;
}

/** The same step timing selects the green word in canvas and ASS export. */
export function keywordAtTime(elapsedMs: number, durationMs: number, wordCount: number): number {
  if (wordCount < 1) return -1;
  return Math.min(wordCount - 1, Math.max(0, Math.floor(Math.max(0, elapsedMs) * wordCount / Math.max(1, durationMs))));
}

function keywordAssText(lines: string[], activeIndex: number): string {
  let offset = 0;
  return lines.map(line => {
    const words = line.split(/\s+/).filter(Boolean);
    const colored = words.map((word, index) => offset + index === activeIndex
      ? `{\\c&H00A0E500&}${word}{\\c&H00FFFFFF&}` : word).join(" ");
    offset += words.length;
    return colored;
  }).join("\\N");
}

function keywordDialogues(startMs: number, endMs: number, lines: string[]): string[] {
  const count = lines.join(" ").split(/\s+/).filter(Boolean).length;
  if (!count) return [];
  const events: string[] = [];
  for (let index = 0; index < count; index++) {
    const start = Math.round(startMs + (endMs - startMs) * index / count);
    const end = Math.round(startMs + (endMs - startMs) * (index + 1) / count);
    if (end > start) events.push(dialogue(start, end, keywordAssText(lines, index)));
  }
  return events;
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
  res: PlayRes = DEFAULT_RES,
  bottomInsetOrOptions: number | CaptionOptions = 0,
  composed = false,
  captionOptions?: CaptionOptions
): string {
  const bottomInset = typeof bottomInsetOrOptions === 'number' ? bottomInsetOrOptions : 0;
  const options = typeof bottomInsetOrOptions === 'number' ? captionOptions : bottomInsetOrOptions;
  const sections = [assHeader(res), "", styleBlock(style, res, bottomInset, options), "", EVENTS_HEADER];

  // KLYP and SPARK show one word at a time; other styles show small word groups.
  const cues = buildCaptionCues(words, clipStartMs, clipEndMs,
    style === "KLYP" || style === "SPARK" ? 1 : CUE_MAX_WORDS);
  for (const cue of cues) {
    const text = sanitizeAssText(style === "KLYP" || style === "SPARK" ? cue.text.toUpperCase() : cue.text);
    const wrapped = composed ? wrapCaptionText(text, style).join("\\N") : text;
    if (style === "KEYWORD") sections.push(...keywordDialogues(cue.startMs, cue.endMs,
      composed ? wrapCaptionText(text, style) : [text]));
    else sections.push(dialogue(cue.startMs, cue.endMs,
      captionAssMotion(style, res.w, res.h, options?.position ?? "BOTTOM") + wrapped));
  }

  return sections.join("\n");
}

/** How long the hook title stays on screen at the start of a clip. */
export const HOOK_DURATION_MS = 3000;

/** Hook text style presets — CapCut-style looks. Fonts must exist on the server. */
export const HOOK_STYLES = ["CLASSIC", "IMPACT", "YELLOW", "BOXED", "NEON", "WHITE_BOX"] as const;
export type HookStyle = (typeof HOOK_STYLES)[number];

/**
 * Hook style parameters at the reference 1080×1920 resolution.
 * borderStyle 1 = outline+shadow, 3 = opaque box (fill = OutlineColour).
 * Outline widths on the stroke styles sit at ~15-18% of the font size — thick
 * meme-caption strokes ("RAKAI CRASHED OUT" style), not thin subtitle borders.
 */
const HOOK_STYLE_PARAMS: Record<
  HookStyle,
  { font: string; fontSize: number; color: string; bold: 0 | 1; outline: number; borderStyle: 1 | 3; boxColor?: string }
> = {
  // Bold white, thick black outline — classic meme caption.
  CLASSIC: { font: "Arial", fontSize: 72, color: "&H00FFFFFF", bold: 1, outline: 12, borderStyle: 1 },
  // Impact font, extra-thick outline — heavy meme/top-text energy. The default.
  IMPACT: { font: "Impact", fontSize: 78, color: "&H00FFFFFF", bold: 0, outline: 14, borderStyle: 1 },
  // Yellow Arial Black — the "subtitle yellow" CapCut preset.
  YELLOW: { font: "Arial Black", fontSize: 66, color: "&H0000FFFF", bold: 1, outline: 4, borderStyle: 1 },
  // White text on a solid black box — news-banner style.
  BOXED: { font: "Arial", fontSize: 64, color: "&H00FFFFFF", bold: 1, outline: 14, borderStyle: 3 },
  // Klyp green (#00E5A0) — branded neon look.
  NEON: { font: "Arial", fontSize: 72, color: "&H00A0E500", bold: 1, outline: 4, borderStyle: 1 },
  // Heavy black text on a compact white card, for spoken-story hooks.
  WHITE_BOX: { font: "Arial Black", fontSize: 62, color: "&H00000000", bold: 1, outline: 0, borderStyle: 1 },
};

/** One card around all hook lines, shared by canvas preview and ASS export. */
export function whiteBoxCardGeometry(lines: string[], fontSize: number, lineHeight: number, cx: number, firstY: number, res: PlayRes) {
  const scale = res.h / DEFAULT_RES.h;
  const padX = Math.max(6, Math.round(20 * scale));
  const padY = Math.max(4, Math.round(9 * scale));
  const textWidth = Math.max(0, ...lines.map(line => line.length * fontSize * .62));
  const width = Math.min(res.w - 8, Math.ceil(textWidth + padX * 2));
  const height = Math.ceil((lines.length - 1) * lineHeight + fontSize + padY * 2);
  const x = Math.round(Math.max(4, Math.min(res.w - width - 4, cx - width / 2)));
  const y = Math.round(Math.max(4, Math.min(res.h - height - 4, firstY - padY)));
  return { x, y, width, height, radius: Math.max(3, Math.round(9 * scale)) };
}

function roundedCardPath(width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2);
  const c = Math.round(r * .55), right = width - r, bottom = height - r;
  return `m ${r} 0 l ${right} 0 b ${right+c} 0 ${width} ${r-c} ${width} ${r} l ${width} ${bottom} b ${width} ${bottom+c} ${right+c} ${height} ${right} ${height} l ${r} ${height} b ${r-c} ${height} 0 ${bottom+c} 0 ${bottom} l 0 ${r} b 0 ${r-c} ${r-c} 0 ${r} 0`;
}

/** Shared geometry for manually placed hooks in canvas and ASS export. */
export function hookTextLayout(hook:string,res:PlayRes,style:HookStyle,placement:TextPlacement) {
  const p=HOOK_STYLE_PARAMS[style],fontSize=Math.max(10,Math.round(p.fontSize*res.h/DEFAULT_RES.h*placement.scale));
  const lineHeight=Math.round(fontSize*1.25);
  const available=2*Math.min(placement.x,1-placement.x);
  const limit=Math.max(6,Math.floor((style === "WHITE_BOX" ? 18 : 30)*available/placement.scale));
  const lines=wrapCaptionText(hook.toUpperCase(),"BOLD",limit);
  const margin=Math.max(6,Math.round(20*res.h/DEFAULT_RES.h));
  const height=lines.length*lineHeight;
  const estimatedWidth=Math.min(res.w-2*margin,Math.max(0,...lines.map(line=>line.length*fontSize*.53)));
  const x=Math.round(Math.max(estimatedWidth/2+margin,Math.min(res.w-estimatedWidth/2-margin,placement.x*res.w)));
  const y=Math.round(Math.max(height/2+margin,Math.min(res.h-height/2-margin,placement.y*res.h)));
  return {lines,fontSize,lineHeight,x,y,firstY:y-height/2};
}

/**
 * Generate an ASS file that burns the selected hook as a big top-center title
 * for the first few seconds of the clip (Alignment 8 = top-center).
 */
export function generateHookAss(
  hook: string,
  res: PlayRes = DEFAULT_RES,
  style: HookStyle = "CLASSIC",
  placement?: TextPlacement,
): string {
  const p = HOOK_STYLE_PARAMS[style];
  const scale = res.h / DEFAULT_RES.h;
  const custom=placement?hookTextLayout(hook,res,style,placement):null;
  const size = custom?.fontSize ?? Math.round(p.fontSize * scale);
  const outline = Math.max(1, Math.round(p.outline * scale * (placement?.scale ?? 1)));
  const marginV = placement ? 0 : Math.round(HOOK_TOP_MARGIN_REF * scale);
  const marginH = style === "WHITE_BOX" ? Math.round(res.w * 0.15) : 40;
  const whiteBoxLines = style === "WHITE_BOX" && !custom ? wrapCaptionText(hook.toUpperCase(), "BOLD", 18) : null;
  const hookStyle = [
    "[V4+ Styles]",
    STYLES_FORMAT,
    `Style: Hook,${p.font},${size},${p.color},${p.color},${p.boxColor ?? '&H00000000'},&H00000000,${p.bold},0,0,0,100,100,0,0,${p.borderStyle},${outline},0,${placement ? 5 : 8},${marginH},${marginH},${marginV},1`,
  ].join("\n");

  const lines = custom?.lines ?? whiteBoxLines;
  const card = style === "WHITE_BOX" && lines
    ? whiteBoxCardGeometry(lines, size, custom?.lineHeight ?? Math.round(size * 1.25), custom?.x ?? res.w / 2, custom?.firstY ?? marginV, res)
    : null;
  const cardEvent = card
    ? dialogue(0, HOOK_DURATION_MS, `{\\an7\\pos(${card.x},${card.y})\\p1\\1c&H00FFFFFF&\\bord0\\shad0}${roundedCardPath(card.width,card.height,card.radius)}`, "Hook", 0)
    : null;
  return [
    assHeader(res),
    "",
    hookStyle,
    "",
    EVENTS_HEADER,
    ...(cardEvent ? [cardEvent] : []),
    dialogue(0, HOOK_DURATION_MS, `${custom ? `{\\an5\\pos(${custom.x},${custom.y})}` : ''}${custom ? custom.lines.map(sanitizeAssText).join('\\N') : whiteBoxLines ? whiteBoxLines.map(sanitizeAssText).join('\\N') : sanitizeAssText(hook).toUpperCase()}`, "Hook", cardEvent ? 1 : 0),
  ].join("\n");
}

/**
 * Convert a filesystem path to the form FFmpeg's `subtitles` filter accepts on
 * Windows: forward slashes + escaped drive-letter colon (`C\:`).
 */
export function toFfmpegPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^([A-Za-z]):/, "$1\\:");
}

export type CaptionAppearance = { color: string; assColor: string; anchorY: number; alignment: 8 | 5 | 2; transform?: TextPlacement };
/** Shared normalized anchors use the caption-safe rectangle supplied by the layout. */
export function captionAppearance(draft: { caption_color: "white" | "yellow" | "green" | "pink"; caption_position: "top" | "center" | "bottom"; caption_placement?: TextPlacement }): CaptionAppearance {
 const color = { white: "#FFFFFF", yellow: "#FFFF00", green: "#00E5A0", pink: "#FF69B4" }[draft.caption_color];
 return { color, assColor: `&H00${color.slice(5,7)}${color.slice(3,5)}${color.slice(1,3)}`,
 anchorY: draft.caption_position === "top" ? 80/1920 : draft.caption_position === "center" ? 0.5 : 1-80/1920,
 alignment: draft.caption_position === "top" ? 8 : draft.caption_position === "center" ? 5 : 2,
 ...(draft.caption_placement ? {transform:draft.caption_placement} : {}) };
}

/** Explicit edited-output cues bypass word grouping and absolute-VOD subtraction. */
export function generateTimedCueAss(
 cues: readonly { id?: string; start_ms: number; end_ms: number; text: string }[],
 style: CaptionStyle,
 appearance: CaptionAppearance,
 res: PlayRes = DEFAULT_RES,
 safeArea: { x: number; y: number; w: number; h: number } | ((cue: { id?: string; start_ms: number; end_ms: number; text: string }) => { x: number; y: number; w: number; h: number }) = { x: 0, y: 0, w: res.w, h: res.h },
 font: CaptionFont = "sans",
): string {
 const textScale=appearance.transform?.scale ?? 1;
 const styles = style === "COMIC" || style === "KEYWORD" ? styleBlock(style, res, 0, undefined, font, textScale)
   : styleBlock(style, res, 0, undefined, font, textScale).replace(STYLE_PARAMS[style].color, appearance.assColor);
 const sections = [assHeader(res), "", styles, "", EVENTS_HEADER];
 for (const cue of normalizeTimedCues(cues)) {
  const layout = layoutTimedCaption(cue.text, style, appearance, res, typeof safeArea === 'function' ? safeArea(cue) : safeArea, font);
  if (style === "KEYWORD") {
   const count = layout.lines.map(line => line.text.split(/\s+/).filter(Boolean).length).reduce((sum, n) => sum + n, 0);
   for (let index = 0; index < count; index++) {
    const start = Math.round(cue.start_ms + (cue.end_ms - cue.start_ms) * index / count);
    const end = Math.round(cue.start_ms + (cue.end_ms - cue.start_ms) * (index + 1) / count);
    if (end <= start) continue;
    let offset = 0;
    for (const line of layout.lines) {
     const words = line.text.split(/\s+/).filter(Boolean);
     sections.push(dialogue(start, end, `${captionAssMotionAt(style, line.x, line.y, res.h)}${keywordAssText([line.text], index - offset)}`));
     offset += words.length;
    }
   }
   continue;
  }
  for (const line of layout.lines) {
   sections.push(dialogue(cue.start_ms, cue.end_ms,
     `${captionAssMotionAt(style, line.x, line.y, res.h)}${line.text}`));
  }
 }
 return sections.join("\n");
}

/** V2 display policy: later cues replace earlier ones and never revive old text. */
export function normalizeTimedCues<T extends { start_ms: number; end_ms: number; text: string }>(cues: readonly T[]): T[] {
 const ordered = cues.map(cue => ({ ...cue, text: sanitizeAssText(cue.text) })).sort((a,b) => a.start_ms - b.start_ms);
 return ordered.map((cue,index) => ({ ...cue, end_ms: Math.min(cue.end_ms, ordered[index+1]?.start_ms ?? Infinity) })).filter(cue => cue.end_ms > cue.start_ms && cue.text.length > 0);
}

/** Position each line explicitly so neither renderer chooses automatic line metrics. */
export function layoutTimedCaption(text: string, style: CaptionStyle, appearance: CaptionAppearance, res: PlayRes = DEFAULT_RES, safeArea = { x: 0, y: 0, w: res.w, h: res.h }, font: CaptionFont = "sans") {
 const p = STYLE_PARAMS[style];
 const fontSize = Math.round(p.fontSize * res.h / DEFAULT_RES.h * (appearance.transform?.scale ?? 1));
 const lineHeight = Math.round(fontSize * 1.2);
 const normalized = sanitizeAssText(style === "KLYP" ? text.toUpperCase() : text);
 const lines = wrapCaptionText(normalized, style, appearance.transform ? Math.max(7,Math.floor((style === "CLEAN" ? 28 : 20)/appearance.transform.scale)) : undefined);
 const outline = Math.max(1, Math.round(p.outline * res.h / DEFAULT_RES.h * (appearance.transform?.scale ?? 1)));
 const edgeMargin = Math.max(6,Math.round(20*res.h/DEFAULT_RES.h));
 const halfBlock = (lines.length-1)*lineHeight/2+fontSize/2+outline;
 const customY=appearance.transform ? Math.max(halfBlock+edgeMargin,Math.min(res.h-halfBlock-edgeMargin,appearance.transform.y*res.h)) : 0;
 const anchor = appearance.transform ? customY : safeArea.y + safeArea.h * appearance.anchorY;
 const firstY = appearance.transform ? anchor - (lines.length-1)*lineHeight/2
   : appearance.alignment === 8 ? anchor + fontSize/2 : appearance.alignment === 5 ? anchor - (lines.length-1)*lineHeight/2 : anchor - fontSize/2 - (lines.length-1)*lineHeight;
 const estimatedWidth=Math.min(res.w-2*edgeMargin,Math.max(...lines.map(line=>line.length*fontSize*.52)));
 const customX=appearance.transform ? Math.max(estimatedWidth/2+edgeMargin,Math.min(res.w-estimatedWidth/2-edgeMargin,appearance.transform.x*res.w)) : 0;
 return { fontSize, lineHeight, fontFamily: captionFontFamily(font), bold: p.bold === 1, italic: p.italic === 1, outline, shadow: p.shadow,
 lines: lines.map((line,index) => ({ text: line, x: appearance.transform ? customX : safeArea.x + safeArea.w/2, y: firstY + index*lineHeight })) };
}
