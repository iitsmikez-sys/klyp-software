/** Free-export watermark shared by the ASS burn and canvas previews. */

/** The sideways credit is all white. Only the small "klyp" mark at the end has the logo colors ("kl" white, "yp" green). */
type Color = { css: string; ass: string };
/** `scale` makes the part smaller than the main text; `opacity` makes it a little see-through (1 = solid). */
type Part = { text: string; color: Color; scale?: number; opacity?: number };
const WHITE: Color = { css: "#FFFFFF", ass: "&HFFFFFF&" };
const GREEN: Color = { css: "#00E5A0", ass: "&HA0E500&" };
const PARTS: readonly Part[] = [
  { text: "Created by ", color: WHITE },
  { text: "kl", color: WHITE },
  { text: "yp", color: WHITE },
  { text: ".world", color: WHITE },
];
/** The small mark that stays after the credit has folded away: the logo word, then the address a bit smaller and softer. */
const STATIC_PARTS: readonly Part[] = [
  { text: "kl", color: WHITE },
  { text: "yp", color: GREEN },
  { text: ".world", color: WHITE, scale: 0.74, opacity: 0.69 },
];
const TEXT_LENGTH = PARTS.reduce((sum, p) => sum + p.text.length, 0);
const FONT_AT_1080 = 54;
const X_FRACTION = 82 / 470;
const Y_FRACTION = 293 / 836;
const HOLD_END = 3.1;
const TRANSITION_END = 3.8;

type Size = { w: number; h: number };

/** The small "klyp" mark sits a little to the right of the sideways credit's left edge (0.7 of a font height). */
const STATIC_SHIFT = 0.7;

function layout({ w, h }: Size) {
  const fit = Math.min(w / 1080, h / 1920);
  const x = Math.round(w * X_FRACTION);
  const fontSize = Math.max(14, Math.round(FONT_AT_1080 * fit));
  return {
    x,
    y: Math.round(h * Y_FRACTION),
    fontSize,
    staticX: x + Math.round(fontSize * STATIC_SHIFT),
  };
}

function assTime(seconds: number): string {
  const hundredths = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(hundredths / 360000);
  const m = Math.floor(hundredths / 6000) % 60;
  const s = Math.floor(hundredths / 100) % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(hundredths % 100).padStart(2, "0")}`;
}

/** The first `count` characters of the parts, keeping each part's color. */
function partsUpTo(parts: readonly Part[], count: number): Part[] {
  const out: Part[] = [];
  let left = count;
  for (const part of parts) {
    if (left <= 0) break;
    out.push({ ...part, text: part.text.slice(0, left) });
    left -= part.text.length;
  }
  return out;
}

/** ASS text with a color change for each part. */
const coloredAss = (parts: readonly Part[], fontSize: number) => parts.map((p) => {
  const size = p.scale ? `\\fs${Math.round(fontSize * p.scale)}` : "";
  // ASS alpha is "how see-through" in hex (00 solid, FF invisible).
  const alpha = p.opacity !== undefined ? `\\1a&H${Math.round((1 - p.opacity) * 255).toString(16).toUpperCase().padStart(2, "0")}&` : "";
  return `{\\1c${p.color.ass}${size}${alpha}}${p.text}`;
}).join("");

/** ASS gives the exported clip a true rotated typewriter and a static wordmark. */
export function generateWatermarkAss(size: Size, durationSeconds: number): string {
  const { x, y, fontSize, staticX } = layout(size);
  // libass rotates around the alignment anchor, moving glyphs left by roughly
  // one font height; offset the rotated anchor so both states share a left edge.
  const verticalX = x + Math.round(fontSize * .85);
  const staticY = y - Math.round(fontSize * .17);
  const duration = Math.max(0, durationSeconds);
  const events: string[] = [];
  const add = (start: number, end: number, text: string) => {
    if (end > start && start < duration) {
      events.push(`Dialogue: 0,${assTime(start)},${assTime(Math.min(end, duration))},Mark,,0,0,0,,${text}`);
    }
  };
  for (let i = 1; i <= TEXT_LENGTH; i++) {
    const start = (i - 1) / 11;
    const end = i === TEXT_LENGTH ? HOLD_END : i / 11;
    add(start, end, `{\\an7\\pos(${verticalX},${y})\\frz270}${coloredAss(partsUpTo(PARTS, i), fontSize)}`);
  }
  const transitionMs = Math.round((TRANSITION_END - HOLD_END) * 1000);
  add(HOLD_END, TRANSITION_END,
    `{\\an7\\pos(${verticalX},${y})\\frz270\\t(0,${transitionMs},\\fscx8\\alpha&HFF&)}${coloredAss(PARTS, fontSize)}`);
  add(HOLD_END + 0.35, duration,
    `{\\an7\\pos(${staticX},${staticY})\\fad(350,0)}${coloredAss(STATIC_PARTS, fontSize)}`);
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: ${size.w}\nPlayResY: ${size.h}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n` +
    `[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n` +
    `Style: Mark,Arial,${fontSize},&H00FFFFFF,&H00FFFFFF,&H80000000,&H80000000,-1,0,0,0,100,100,0,0,1,1,1,7,0,0,0,1\n\n` +
    `[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${events.join("\n")}\n`;
}

/** Escaping matches the existing subtitles filter used for captions and hooks. */
export function watermarkFilter(assPath: string): string {
  const escaped = assPath.replace(/\\/g, "/").replace(/^([A-Za-z]):/, "$1\\:");
  return `subtitles='${escaped}'`;
}

/** Draw colored parts one after another starting at the current origin. */
function fillParts(ctx: CanvasRenderingContext2D, parts: readonly Part[], fontSize: number): void {
  let offset = 0;
  const alpha = ctx.globalAlpha;
  for (const part of parts) {
    const size = fontSize * (part.scale ?? 1);
    ctx.font = `bold ${size}px Arial`;
    ctx.fillStyle = part.color.css;
    ctx.globalAlpha = alpha * (part.opacity ?? 1);
    // Smaller text hangs from the same top edge, so lower it to share the baseline with the larger text.
    ctx.fillText(part.text, offset, (fontSize - size) * 0.905);
    offset += ctx.measureText(part.text).width;
  }
  ctx.globalAlpha = alpha;
  ctx.font = `bold ${fontSize}px Arial`;
}

export function drawWatermarkPreview(
  ctx: CanvasRenderingContext2D, time: number,
  width: number, height: number, outputWidth = width, outputHeight = height
): void {
  if (width <= 0 || height <= 0 || time < 0) return;
  const { x, y, fontSize, staticX } = layout({ w: outputWidth, h: outputHeight });
  ctx.save();
  ctx.scale(width / outputWidth, height / outputHeight);
  ctx.font = `bold ${fontSize}px Arial`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.shadowColor = "rgba(0,0,0,.65)";
  ctx.shadowBlur = Math.max(2, fontSize * .08);
  const staticAt = (alpha: number) => {
    ctx.globalAlpha = alpha;
    ctx.save();
    ctx.translate(staticX, y - fontSize * .17);
    fillParts(ctx, STATIC_PARTS, fontSize);
    ctx.restore();
  };
  if (time < HOLD_END) {
    const count = Math.min(TEXT_LENGTH, Math.max(0, Math.floor(time * 11) + 1));
    ctx.globalAlpha = .92;
    ctx.save();
    ctx.translate(x + fontSize * .85, y);
    ctx.rotate(Math.PI / 2);
    fillParts(ctx, partsUpTo(PARTS, count), fontSize);
    ctx.restore();
  } else if (time < TRANSITION_END) {
    const progress = (time - HOLD_END) / (TRANSITION_END - HOLD_END);
    const ease = progress * progress * (3 - 2 * progress);
    const fold = Math.min(1, ease / .55);
    const reveal = Math.max(0, Math.min(1, (ease - .45) / .55));
    ctx.save();
    ctx.globalAlpha = .92 * (1 - fold);
    ctx.translate(x + fontSize * .85, y);
    ctx.rotate(Math.PI / 2);
    ctx.scale(1 - .92 * fold, 1);
    fillParts(ctx, PARTS, fontSize);
    ctx.restore();
    staticAt(.92 * reveal);
  } else {
    staticAt(.92);
  }
  ctx.restore();
}
