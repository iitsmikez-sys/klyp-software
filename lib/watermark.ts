/** Free-export watermark shared by the ASS burn and canvas previews. */

/** The credit, in the logo's colors: "kl" white, "yp" green, the rest white. */
const WHITE = { css: "#FFFFFF", ass: "&HFFFFFF&" };
const GREEN = { css: "#00E5A0", ass: "&HA0E500&" };
const PARTS: readonly { text: string; color: typeof WHITE }[] = [
  { text: "Created by ", color: WHITE },
  { text: "kl", color: WHITE },
  { text: "yp", color: GREEN },
  { text: ".world", color: WHITE },
];
/** The small mark that stays after the credit has left: just the logo word. */
const STATIC_PARTS: readonly { text: string; color: typeof WHITE }[] = [
  { text: "kl", color: WHITE },
  { text: "yp", color: GREEN },
];
const FONT_AT_1080 = 54;
const X_FRACTION = 82 / 470;
const Y_FRACTION = 293 / 836;
/** The credit slides in from the left edge, stays, then fades out as the small mark slides in. */
const SLIDE_IN = 0.45;
const HOLD_END = 3.1;
const CREDIT_END = 3.5;
const STATIC_START = 3.3;
const STATIC_SLIDE = 0.35;

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

/** ASS text with a color change for each part. */
const coloredAss = (parts: typeof PARTS) => parts.map((p) => `{\\1c${p.color.ass}}${p.text}`).join("");

/** ASS gives the exported clip a rotated credit that slides in, then a small logo word. */
export function generateWatermarkAss(size: Size, durationSeconds: number): string {
  const { x, y, fontSize } = layout(size);
  // libass rotates around the alignment anchor, moving glyphs left by roughly
  // one font height; offset the rotated anchor so both states share a left edge.
  const verticalX = x + Math.round(fontSize * .85);
  const staticY = y - Math.round(fontSize * .17);
  const fromX = -Math.round(fontSize * 1.2);
  const duration = Math.max(0, durationSeconds);
  const events: string[] = [];
  const add = (start: number, end: number, text: string) => {
    if (end > start && start < duration) {
      events.push(`Dialogue: 0,${assTime(start)},${assTime(Math.min(end, duration))},Mark,,0,0,0,,${text}`);
    }
  };
  const slideMs = Math.round(SLIDE_IN * 1000);
  add(0, CREDIT_END,
    `{\\an7\\frz270\\move(${fromX},${y},${verticalX},${y},0,${slideMs})\\fad(300,${Math.round((CREDIT_END - HOLD_END) * 1000)})}${coloredAss(PARTS)}`);
  const staticMs = Math.round(STATIC_SLIDE * 1000);
  add(STATIC_START, duration,
    `{\\an7\\move(${x - Math.round(fontSize * .7)},${staticY},${x},${staticY},0,${staticMs})\\fad(${staticMs},0)}${coloredAss(STATIC_PARTS as typeof PARTS)}`);
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

const ease = (p: number) => { const c = Math.max(0, Math.min(1, p)); return c * c * (3 - 2 * c); };

/** Draw colored parts one after another starting at the current origin. */
function fillParts(ctx: CanvasRenderingContext2D, parts: typeof PARTS): void {
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
  if (time < CREDIT_END) {
    // The credit slides in from the left edge, then fades out at the end.
    const slide = (1 - ease(time / SLIDE_IN)) * (x + fontSize * .85 + fontSize * 1.2);
    const fadeIn = Math.min(1, time / .3), fadeOut = time > HOLD_END ? 1 - (time - HOLD_END) / (CREDIT_END - HOLD_END) : 1;
    ctx.globalAlpha = .92 * fadeIn * Math.max(0, fadeOut);
    ctx.save();
    ctx.translate(x + fontSize * .85 - slide, y);
    ctx.rotate(Math.PI / 2);
    fillParts(ctx, PARTS);
    ctx.restore();
  }
  if (time >= STATIC_START) {
    const p = (time - STATIC_START) / STATIC_SLIDE;
    ctx.globalAlpha = .92 * Math.min(1, p);
    ctx.save();
    ctx.translate(x - (1 - ease(p)) * fontSize * .7, y - fontSize * .17);
    fillParts(ctx, STATIC_PARTS as typeof PARTS);
    ctx.restore();
  }
  ctx.restore();
}
