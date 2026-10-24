import type { CaptionStyle } from "./clips";
import type { CaptionPosition } from "./editor-captions";

export type CaptionMotion = { scale: number; yOffset: number; alpha: number };
const progress = (elapsedMs: number, durationMs: number) =>
  Math.max(0, Math.min(1, elapsedMs / durationMs));

/** Values shared by live canvas preview and the ASS export keyframes. */
export function captionMotion(style: CaptionStyle, elapsedMs: number): CaptionMotion {
  if (style === "PULSE") return {
    scale: 0.72 + 0.28 * progress(elapsedMs, 180), yOffset: 0,
    alpha: progress(elapsedMs, 80),
  };
  if (style === "SLIDE") return {
    scale: 1, yOffset: 55 * (1 - progress(elapsedMs, 220)),
    alpha: progress(elapsedMs, 180),
  };
  if (style === "SPARK") return {
    scale: 0.82 + 0.18 * progress(elapsedMs, 140), yOffset: 0,
    alpha: progress(elapsedMs, 60),
  };
  return { scale: 1, yOffset: 0, alpha: 1 };
}

export function captionAssMotion(
  style: CaptionStyle, width: number, height: number, position: CaptionPosition,
): string {
  if (style === "PULSE") return "{\\fscx72\\fscy72\\t(0,180,\\fscx100\\fscy100)\\fad(80,0)}";
  if (style === "SPARK") return "{\\fscx82\\fscy82\\t(0,140,\\fscx100\\fscy100)\\fad(60,0)}";
  if (style === "SLIDE") {
    const scale = height / 1920;
    const y = position === "TOP" ? 400 * scale : position === "CENTER" ? height / 2 : height - 80 * scale;
    const x = width / 2;
    return `{\\move(${Math.round(x)},${Math.round(y + 55 * scale)},${Math.round(x)},${Math.round(y)},0,220)\\fad(180,0)}`;
  }
  return "";
}
