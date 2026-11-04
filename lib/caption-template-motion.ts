import type { CaptionStyle } from "./clips";
import type { CaptionPosition } from "./editor-captions";

/** Clean captions fade in while drifting up a little: 28px (at 1920 tall) over 350ms. */
export const CLEAN_RISE_PX = 28;
export const CLEAN_RISE_MS = 350;

/** Bold captions pop in like CapCut's default: from 85% up to 106% in 100ms, then settle to full size by 200ms. */
export const BOLD_POP = { fromScale: 0.85, peakScale: 1.06, riseMs: 100, settleMs: 100, fadeMs: 60 } as const;

export type CaptionMotion = { scale: number; yOffset: number; alpha: number };
const progress = (elapsedMs: number, durationMs: number) =>
  Math.max(0, Math.min(1, elapsedMs / durationMs));

/** Values shared by live canvas preview and the ASS export keyframes. */
export function captionMotion(style: CaptionStyle, elapsedMs: number): CaptionMotion {
  if (style === "BOLD") return {
    scale: elapsedMs < BOLD_POP.riseMs
      ? BOLD_POP.fromScale + (BOLD_POP.peakScale - BOLD_POP.fromScale) * progress(elapsedMs, BOLD_POP.riseMs)
      : BOLD_POP.peakScale - (BOLD_POP.peakScale - 1) * progress(elapsedMs - BOLD_POP.riseMs, BOLD_POP.settleMs),
    yOffset: 0, alpha: progress(elapsedMs, BOLD_POP.fadeMs),
  };
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
  if (style === "POP") return {
    scale: elapsedMs < 90 ? 0.7 + 0.45 * progress(elapsedMs, 90) : 1.15 - 0.15 * progress(elapsedMs - 90, 110),
    yOffset: 0, alpha: progress(elapsedMs, 50),
  };
  if (style === "CLEAN") return {
    scale: 1, yOffset: CLEAN_RISE_PX * (1 - progress(elapsedMs, CLEAN_RISE_MS)),
    alpha: progress(elapsedMs, CLEAN_RISE_MS),
  };
  if (style === "SPARK") return {
    scale: 0.82 + 0.18 * progress(elapsedMs, 140), yOffset: 0,
    alpha: progress(elapsedMs, 60),
  };
  return { scale: 1, yOffset: 0, alpha: 1 };
}

export function captionAssMotion(
  style: CaptionStyle, width: number, height: number, position: CaptionPosition, bottomInset = 0,
): string {
  if (style === "BOLD") return "{\\fscx85\\fscy85\\t(0,100,\\fscx106\\fscy106)\\t(100,200,\\fscx100\\fscy100)\\fad(60,0)}";
  if (style === "COMIC") return "{\\fscx72\\fscy72\\t(0,100,\\fscx108\\fscy108)\\t(100,300,\\fscx100\\fscy100)\\fad(55,0)}";
  if (style === "PULSE") return "{\\fscx72\\fscy72\\t(0,180,\\fscx100\\fscy100)\\fad(80,0)}";
  if (style === "BOUNCE") return "{\\fscx58\\fscy58\\t(0,110,\\fscx110\\fscy110)\\t(110,250,\\fscx100\\fscy100)\\fad(65,0)}";
  if (style === "GLOW") return "{\\fscx95\\fscy95\\t(0,220,\\fscx100\\fscy100)\\fad(180,0)}";
  if (style === "POP") return "{\\fscx70\\fscy70\\t(0,90,\\fscx115\\fscy115)\\t(90,200,\\fscx100\\fscy100)\\fad(50,0)}";
  if (style === "SPARK") return "{\\fscx82\\fscy82\\t(0,140,\\fscx100\\fscy100)\\fad(60,0)}";
  if (style === "SLIDE" || style === "CLEAN") {
    const scale = height / 1920;
    const y = position === "TOP" ? 400 * scale : position === "CENTER" ? height / 2 : height - 80 * scale - bottomInset;
    const x = width / 2;
    const [rise, ms, fade] = style === "SLIDE" ? [55, 220, 180] : [CLEAN_RISE_PX, CLEAN_RISE_MS, CLEAN_RISE_MS];
    return `{\\move(${Math.round(x)},${Math.round(y + rise * scale)},${Math.round(x)},${Math.round(y)},0,${ms})\\fad(${fade},0)}`;
  }
  return "";
}

/** Motion for captions positioned inside an editor layout's safe area. */
export function captionAssMotionAt(style: CaptionStyle, x: number, y: number, height: number): string {
  if (style === "SLIDE" || style === "CLEAN") {
    const clean = style === "CLEAN";
    const rise = Math.round((clean ? CLEAN_RISE_PX : 55) * height / 1920);
    return `{\\an5\\move(${x},${y + rise},${x},${y},0,${clean ? CLEAN_RISE_MS : 220})\\fad(${clean ? CLEAN_RISE_MS : 180},0)}`;
  }
  const glow = style === "GLOW" ? "\\shad0\\bord4\\3c&H00FF99FF&\\blur2" : "";
  return `{\\an5\\pos(${x},${y})${glow}${captionAssMotion(style, 0, height, "CENTER").slice(1, -1)}}`;
}
