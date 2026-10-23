import type { CaptionStyle } from "./clips";
import type { CaptionCue } from "./captions";
import { CAPTION_HEX, type CaptionOptions } from "./editor-captions";

/** Draw the currently active ASS cue at approximately its export position. */
export function drawCaptionPreview(
  ctx: CanvasRenderingContext2D, tSeconds: number, cues: CaptionCue[],
  style: CaptionStyle, options: CaptionOptions, width: number, height: number,
): void {
  const cue = cues.find((item) => tSeconds * 1000 >= item.startMs && tSeconds * 1000 < item.endMs);
  if (!cue) return;
  const scale = height / 1920;
  const size = Math.max(12, Math.round((style === "CLEAN" ? 58 : 82) * scale));
  const y = options.position === "TOP" ? 400 * scale
    : options.position === "CENTER" ? height / 2 : height - 80 * scale;
  const color = options.color === "DEFAULT"
    ? style === "KLYP" ? CAPTION_HEX.GREEN : CAPTION_HEX.WHITE : CAPTION_HEX[options.color];
  const text = style === "KLYP" ? cue.text.toUpperCase() : cue.text;
  ctx.save();
  ctx.font = `${style === "CLEAN" ? "" : "bold "}${size}px Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = options.position === "TOP" ? "top" : options.position === "CENTER" ? "middle" : "bottom";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(2, (style === "CLEAN" ? 4 : 8) * scale);
  ctx.strokeStyle = "black";
  ctx.fillStyle = color;
  ctx.strokeText(text, width / 2, y, width - 20);
  ctx.fillText(text, width / 2, y, width - 20);
  ctx.restore();
}
