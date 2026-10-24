import type { CaptionStyle } from "./clips";
import type { CaptionPosition } from "./editor-captions";

export type CaptionMotion = { scale: number; yOffset: number; alpha: number };
const progress = (elapsedMs: number, durationMs: number) =>
  Math.max(0, Math.min(1, elapsedMs / durationMs));

/** Values shared by live canvas preview and the ASS export keyframes. */
export function captionMotion(style: CaptionStyle, elapsedMs: number): CaptionMotion {
  if (style === "COMIC") return {
    scale: elapsedMs < 100 ? 0.72 + 0.36 * progress(elapsedMs, 100) : 1.08 - 0.08 * progress(elapsedMs - 100, 200),
    yOffset: 0, alpha: progress(elapsedMs, 55),
  };
  if (style === "BOUNCE") return {
    scale: elapsedMs < 110 ? 0.58 + 0.52 * progress(elapsedMs, 110) : 1.1 - 0.1 * progress(elapsedMs - 110, 140),
    yOffset: 0, alpha: progress(elapsedMs, 65),
  };
  if (style === "GLOW") return {
    scale: 0.95 + 0.05 * progress(elapsedMs, 220), yOffset: 0,
    alpha: progress(elapsedMs, 180),
  };
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
  if (style === "COMIC") return "{\\fscx72\\fscy72\\t(0,100,\\fscx108\\fscy108)\\t(100,300,\\fscx100\\fscy100)\\fad(55,0)}";
  if (style === "PULSE") return "{\\fscx72\\fscy72\\t(0,180,\\fscx100\\fscy100)\\fad(80,0)}";
  if (style === "BOUNCE") return "{\\fscx58\\fscy58\\t(0,110,\\fscx110\\fscy110)\\t(110,250,\\fscx100\\fscy100)\\fad(65,0)}";
  if (style === "GLOW") return "{\\fscx95\\fscy95\\t(0,220,\\fscx100\\fscy100)\\fad(180,0)}";
  if (style === "SPARK") return "{\\fscx82\\fscy82\\t(0,140,\\fscx100\\fscy100)\\fad(60,0)}";
  if (style === "SLIDE") {
    const scale = height / 1920;
    const y = position === "TOP" ? 400 * scale : position === "CENTER" ? height / 2 : height - 80 * scale;
    const x = width / 2;
    return `{\\move(${Math.round(x)},${Math.round(y + 55 * scale)},${Math.round(x)},${Math.round(y)},0,220)\\fad(180,0)}`;
  }
  return "";
}

/** Motion for captions positioned inside an editor layout's safe area. */
export function captionAssMotionAt(style: CaptionStyle, x: number, y: number, height: number): string {
  if (style === "SLIDE") {
    const rise = Math.round(55 * height / 1920);
    return `{\\an5\\move(${x},${y + rise},${x},${y},0,220)\\fad(180,0)}`;
  }
  return `{\\an5\\pos(${x},${y})${captionAssMotion(style, 0, height, "CENTER").slice(1, -1)}}`;
}
