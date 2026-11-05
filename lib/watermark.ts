/** Free-export watermark shared by the ASS burn and canvas previews. */

/** The credit, in the logo's colors: "kl" white, "yp" green, the rest white. */
type Color = { css: string; ass: string };
type Part = { text: string; color: Color };
const WHITE: Color = { css: "#FFFFFF", ass: "&HFFFFFF&" };
const GREEN: Color = { css: "#00E5A0", ass: "&HA0E500&" };
const PARTS: readonly Part[] = [
  { text: "Created by ", color: WHITE },
  { text: "kl", color: WHITE },
  { text: "yp", color: GREEN },
  { text: ".world", color: WHITE },
];
/** The small mark that stays after the credit has folded away: just the logo word. */
const STATIC_PARTS: readonly Part[] = [
  { text: "kl", color: WHITE },
  { text: "yp", color: GREEN },
];
const TEXT_LENGTH = PARTS.reduce((sum, p) => sum + p.text.length, 0);
const FONT_AT_1080 = 54;
const X_FRACTION = 82 / 470;
const Y_FRACTION = 293 / 836;
const HOLD_END = 3.1;
const TRANSITION_END = 3.8;

type Size = { w: number; h: number };

function layout({ w, h }: Size) {
  const fit = Math.min(w / 1080, h / 1920);
  return {
    x: Math.round(w * X_FRACTION),
    y: Math.round(h * Y_FRACTION),
    fontSize: Math.max(14, Math.round(FONT_AT_1080 * fit)),
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
    out.push({ text: part.text.slice(0, left), color: part.color });
    left -= part.text.length;
  }
  return out;
}

/** ASS text with a color change for each part. */
const coloredAss = (parts: readonly Part[]) => parts.map((p) => `{\\1c${p.color.ass}}${p.text}`).join("");

/** ASS gives the exported clip a true rotated typewriter and a static wordmark. */
export function generateWatermarkAss(size: Size, durationSeconds: number): string {
  const { x, y, fontSize } = layout(size);
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
    add(start, end, `{\\an7\\pos(${verticalX},${y})\\frz270}${coloredAss(partsUpTo(PARTS, i))}`);
  }
  const transitionMs = Math.round((TRANSITION_END - HOLD_END) * 1000);
  add(HOLD_END, TRANSITION_END,
    `{\\an7\\pos(${verticalX},${y})\\frz270\\t(0,${transitionMs},\\fscx8\\alpha&HFF&)}${coloredAss(PARTS)}`);
  add(HOLD_END + 0.35, duration,
    `{\\an7\\pos(${x},${staticY})\\fad(350,0)}${coloredAss(STATIC_PARTS)}`);
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
function fillParts(ctx: CanvasRenderingContext2D, parts: readonly Part[]): void {
  let offset = 0;
  for (const part of parts) {
    ctx.fillStyle = part.color.css;
    ctx.fillText(part.text, offset, 0);
    offset += ctx.measureText(part.text).width;
  }
}

export function drawWatermarkPreview(
  ctx: CanvasRenderingContext2D, time: number,
  width: number, height: number, outputWidth = width, outputHeight = height
): void {
  if (width <= 0 || height <= 0 || time < 0) return;
  const { x, y, fontSize } = layout({ w: outputWidth, h: outputHeight });
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
    ctx.translate(x, y - fontSize * .17);
    fillParts(ctx, STATIC_PARTS);
    ctx.restore();
  };
  if (time < HOLD_END) {
    const count = Math.min(TEXT_LENGTH, Math.max(0, Math.floor(time * 11) + 1));
    ctx.globalAlpha = .92;
    ctx.save();
    ctx.translate(x + fontSize * .85, y);
    ctx.rotate(Math.PI / 2);
    fillParts(ctx, partsUpTo(PARTS, count));
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
    fillParts(ctx, PARTS);
    ctx.restore();
    staticAt(.92 * reveal);
  } else {
    staticAt(.92);
  }
  ctx.restore();
}
