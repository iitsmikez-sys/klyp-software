/**
 * Canvas renderer for the hook title overlay in preview players.
 * Mirrors the ASS presets in lib/captions.ts (HOOK_STYLE_PARAMS) so what the
 * user sees in the player matches what FFmpeg burns on export: top-center,
 * uppercase, visible for the first HOOK_DURATION_MS of the clip.
 */
import { HOOK_DURATION_MS, type HookStyle } from "./captions";

type PreviewParams = {
  font: string;
  fontSize: number; // at the reference 1920px-tall frame
  color: string;
  bold: boolean;
  outline: number; // stroke width at reference size (ignored when boxed)
  boxed: boolean; // black bar behind the text instead of an outline
};

/** Keep in sync with HOOK_STYLE_PARAMS in lib/captions.ts. */
const PREVIEW_PARAMS: Record<HookStyle, PreviewParams> = {
  CLASSIC: { font: "Arial", fontSize: 72, color: "#ffffff", bold: true, outline: 4, boxed: false },
  IMPACT: { font: "Impact, 'Arial Black'", fontSize: 78, color: "#ffffff", bold: false, outline: 5, boxed: false },
  YELLOW: { font: "'Arial Black'", fontSize: 66, color: "#ffff00", bold: true, outline: 4, boxed: false },
  BOXED: { font: "Arial", fontSize: 64, color: "#ffffff", bold: true, outline: 0, boxed: true },
  NEON: { font: "Arial", fontSize: 72, color: "#00E5A0", bold: true, outline: 4, boxed: false },
  TYPEWRITER: { font: "'Courier New'", fontSize: 62, color: "#ffffff", bold: true, outline: 3, boxed: false },
};

/** Greedy word-wrap against the current ctx.font. */
function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && ctx.measureText(candidate).width > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Draw the hook overlay for time `tSeconds` (clip-relative). No-op after the
 * hook window ends. Scales against the canvas height like the export does
 * against PlayResY.
 */
export function drawHookPreview(
  ctx: CanvasRenderingContext2D,
  tSeconds: number,
  hook: string,
  style: HookStyle,
  W: number,
  H: number
) {
  if (tSeconds * 1000 > HOOK_DURATION_MS) return;
  const text = hook.toUpperCase().trim();
  if (!text) return;

  const p = PREVIEW_PARAMS[style];
  const scale = H / 1920;
  const fs = Math.max(10, Math.round(p.fontSize * scale));
  const lineHeight = Math.round(fs * 1.25);
  const marginTop = Math.round(160 * scale);
  const maxWidth = W - Math.round(80 * scale);
  const cx = W / 2;

  ctx.save();
  ctx.font = `${p.bold ? "bold " : ""}${fs}px ${p.font}, Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  const lines = wrapLines(ctx, text, maxWidth);

  lines.forEach((line, i) => {
    const y = marginTop + i * lineHeight;
    if (p.boxed) {
      const w = ctx.measureText(line).width;
      const padX = Math.round(18 * scale);
      const padY = Math.round(8 * scale);
      ctx.fillStyle = "black";
      ctx.fillRect(cx - w / 2 - padX, y - padY, w + padX * 2, fs + padY * 2);
    } else {
      ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(2, p.outline * 2 * scale);
      ctx.strokeStyle = "black";
      ctx.strokeText(line, cx, y);
    }
    ctx.fillStyle = p.color;
    ctx.fillText(line, cx, y);
  });

  ctx.restore();
}
