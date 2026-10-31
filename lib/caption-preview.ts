import type { CaptionStyle } from "./clips";
import { keywordAtTime, type CaptionCue } from "./captions";
import { CAPTION_HEX, type CaptionOptions } from "./editor-captions";
import { captionMotion } from "./caption-template-motion";

/** Paint a whole phrase while one word changes to green at the shared cue step. */
export function paintCaptionLine(ctx: CanvasRenderingContext2D, text: string, x: number, y: number,
  maxWidth: number, style: CaptionStyle, activeWord = -1, wordOffset = 0): void {
  if (style !== "KEYWORD") {
    ctx.strokeText(text, x, y, maxWidth);
    ctx.fillText(text, x, y, maxWidth);
    return;
  }
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return;
  const space = ctx.measureText(" ").width;
  const widths = words.map(word => ctx.measureText(word).width);
  const total = widths.reduce((sum, width) => sum + width, 0) + space * (words.length - 1);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(Math.min(1, maxWidth / Math.max(1, total)), 1);
  ctx.textAlign = "left";
  let cursor = -total / 2;
  words.forEach((word, index) => {
    ctx.strokeText(word, cursor, 0);
    ctx.fillStyle = wordOffset + index === activeWord ? "#00E5A0" : "#FFFFFF";
    ctx.fillText(word, cursor, 0);
    cursor += widths[index] + space;
  });
  ctx.restore();
}

/** Draw the currently active ASS cue at approximately its export position. */
export function drawCaptionPreview(
  ctx: CanvasRenderingContext2D, tSeconds: number, cues: CaptionCue[],
  style: CaptionStyle, options: CaptionOptions, width: number, height: number,
): void {
  const cue = cues.find((item) => tSeconds * 1000 >= item.startMs && tSeconds * 1000 < item.endMs);
  if (!cue) return;
  const scale = height / 1920;
  const motion = captionMotion(style, tSeconds * 1000 - cue.startMs);
  const baseSize = style === "CLEAN" ? 58 : style === "SLIDE" ? 68
    : style === "PULSE" ? 78 : style === "SPARK" ? 88
      : style === "COMIC" ? 76 : style === "KEYWORD" ? 66 : 82;
  const size = Math.max(12, Math.round(baseSize * scale * motion.scale));
  const y = options.position === "TOP" ? 400 * scale
    : options.position === "CENTER" ? height / 2 : height - 80 * scale;
  const color = style === "COMIC" ? "#FFDF00" : style === "KEYWORD" ? "#FFFFFF" : options.color === "DEFAULT"
    ? style === "KLYP" || style === "SPARK" ? CAPTION_HEX.GREEN
      : style === "PULSE" ? CAPTION_HEX.YELLOW : CAPTION_HEX.WHITE : CAPTION_HEX[options.color];
  const text = style === "KLYP" || style === "SPARK" ? cue.text.toUpperCase() : cue.text;
  ctx.save();
  ctx.globalAlpha = motion.alpha;
  if (style === "GLOW") { ctx.shadowColor = "#FF99FF"; ctx.shadowBlur = 10 * height / 960; }
  ctx.font = `${style === "COMIC" ? "italic " : ""}${style === "CLEAN" ? "" : "bold "}${size}px Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = options.position === "TOP" ? "top" : options.position === "CENTER" ? "middle" : "bottom";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(2, (style === "CLEAN" ? 4 : style === "COMIC" ? 14 : 8) * scale);
  ctx.strokeStyle = "black";
  ctx.fillStyle = color;
  paintCaptionLine(ctx, text, width / 2, y + motion.yOffset * scale, width - 20, style,
    keywordAtTime(tSeconds * 1000 - cue.startMs, cue.endMs - cue.startMs, text.trim().split(/\s+/).length));
  ctx.restore();
}
