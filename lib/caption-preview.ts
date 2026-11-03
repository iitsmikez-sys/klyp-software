import type { CaptionStyle } from "./clips";
import { keywordAtTime, defaultCaptionFontFamily, type CaptionCue } from "./captions";
import { ensureCaptionFonts } from "./caption-fonts";
import { CAPTION_HEX, type CaptionOptions } from "./editor-captions";
import { captionMotion } from "./caption-template-motion";
import { EMOJI_FONT, activeWordScale, emojiForText, isHighlightStyle, isUppercaseStyle, wordLook } from "./caption-looks";

/** Paint a whole phrase while one word changes to green at the shared cue step. */
export function paintCaptionLine(ctx: CanvasRenderingContext2D, text: string, x: number, y: number,
  maxWidth: number, style: CaptionStyle, activeWord = -1, wordOffset = 0, emoji: { char: string; color: string } | null = null): void {
  if (!isHighlightStyle(style)) {
    ctx.strokeText(text, x, y, maxWidth);
    ctx.fillText(text, x, y, maxWidth);
    return;
  }
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return;
  const space = ctx.measureText(" ").width;
  // Focus draws the active word larger, so its width and position grow with it.
  const grow = (index: number) => (wordOffset + index === activeWord ? activeWordScale(style) : 1);
  const widths = words.map((word, index) => ctx.measureText(word).width * grow(index));
  // Fire's emoji is a flat icon from the bundled emoji font after the last word, as in the export.
  const emojiFont = `${ctx.font.split(" ").find(part => part.endsWith("px")) ?? "40px"} "${EMOJI_FONT}"`;
  const original = ctx.font;
  ctx.font = emojiFont;
  const emojiWidth = emoji ? ctx.measureText(emoji.char).width : 0;
  ctx.font = original;
  const total = widths.reduce((sum, width) => sum + width, 0) + space * (words.length - 1) + (emoji ? space + emojiWidth : 0);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(Math.min(1, maxWidth / Math.max(1, total)), 1);
  ctx.textAlign = "left";
  let cursor = -total / 2;
  words.forEach((word, index) => {
    ctx.save();
    ctx.translate(cursor, 0);
    ctx.scale(grow(index), grow(index));
    ctx.strokeText(word, 0, 0);
    ctx.fillStyle = wordLook(style, activeWord, wordOffset + index === activeWord).css;
    ctx.fillText(word, 0, 0);
    ctx.restore();
    cursor += widths[index] + space;
  });
  if (emoji) {
    ctx.font = emojiFont;
    ctx.strokeText(emoji.char, cursor, 0);
    ctx.fillStyle = emoji.color;
    ctx.fillText(emoji.char, cursor, 0);
    ctx.font = original;
  }
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
      : style === "COMIC" ? 76 : style === "KEYWORD" ? 66 : style === "HYPE" ? 82 : style === "POP" ? 120 : style === "FIRE" ? 68 : style === "TRICOLOR" ? 60 : style === "FOCUS" ? 62 : 82;
  const size = Math.max(12, Math.round(baseSize * scale * motion.scale));
  const y = options.position === "TOP" ? 400 * scale
    : options.position === "CENTER" ? height / 2 : height - 80 * scale;
  const color = style === "COMIC" ? "#FFDF00" : isHighlightStyle(style) ? "#FFFFFF" : options.color === "DEFAULT"
    ? style === "KLYP" || style === "SPARK" ? CAPTION_HEX.GREEN
      : style === "PULSE" || style === "POP" ? CAPTION_HEX.YELLOW : CAPTION_HEX.WHITE : CAPTION_HEX[options.color];
  const text = isUppercaseStyle(style) ? cue.text.toUpperCase() : cue.text;
  ctx.save();
  ctx.globalAlpha = motion.alpha;
  if (style === "GLOW") { ctx.shadowColor = "#FF99FF"; ctx.shadowBlur = 10 * height / 960; }
  ensureCaptionFonts();
  ctx.font = `${style === "COMIC" ? "italic " : ""}${size}px ${defaultCaptionFontFamily(style)}`;
  ctx.textAlign = "center";
  ctx.textBaseline = options.position === "TOP" ? "top" : options.position === "CENTER" ? "middle" : "bottom";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(2, (style === "CLEAN" ? 5 : style === "COMIC" ? 17 : 10) * scale);
  ctx.strokeStyle = "black";
  ctx.fillStyle = color;
  paintCaptionLine(ctx, text, width / 2, y + motion.yOffset * scale, width - 20, style,
    keywordAtTime(tSeconds * 1000 - cue.startMs, cue.endMs - cue.startMs, text.trim().split(/\s+/).length),
    0, style === "FIRE" ? emojiForText(text) : null);
  ctx.restore();
}
