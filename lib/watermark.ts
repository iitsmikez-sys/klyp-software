/** Free-export watermark shared by the ASS burn and canvas previews. */

const TEXT = "Created with klyp";
const STATIC = "klyp";
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
  for (let i = 1; i <= TEXT.length; i++) {
    const start = (i - 1) / 11;
    const end = i === TEXT.length ? HOLD_END : i / 11;
    add(start, end, `{\\an7\\pos(${verticalX},${y})\\frz270}${TEXT.slice(0, i)}`);
  }
  const transitionMs = Math.round((TRANSITION_END - HOLD_END) * 1000);
  add(HOLD_END, TRANSITION_END,
    `{\\an7\\pos(${verticalX},${y})\\frz270\\t(0,${transitionMs},\\fscx8\\alpha&HFF&)}${TEXT}`);
  add(HOLD_END + 0.35, duration,
    `{\\an7\\pos(${x},${staticY})\\fad(350,0)}${STATIC}`);
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
  ctx.fillStyle = "white";
  ctx.shadowColor = "rgba(0,0,0,.65)";
  ctx.shadowBlur = Math.max(2, fontSize * .08);
  if (time < HOLD_END) {
    const count = Math.min(TEXT.length, Math.max(0, Math.floor(time * 11) + 1));
    ctx.globalAlpha = .92;
    ctx.translate(x + fontSize * .85, y);
    ctx.rotate(Math.PI / 2);
    ctx.fillText(TEXT.slice(0, count), 0, 0);
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
    ctx.fillText(TEXT, 0, 0);
    ctx.restore();
    ctx.globalAlpha = .92 * reveal;
    ctx.fillText(STATIC, x, y - fontSize * .17);
  } else {
    ctx.globalAlpha = .92;
    ctx.fillText(STATIC, x, y - fontSize * .17);
  }
  ctx.restore();
}
