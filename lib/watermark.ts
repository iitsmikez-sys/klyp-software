/**
 * Animated Klyp watermark — free-tier only.
 *
 * Motion: three waypoints in a 12-second loop.
 *   0–4s  : bottom-right → center   (linear)
 *   4–8s  : center → bottom-left    (linear)
 *   8–12s : bottom-left → bottom-right (linear)
 *
 * The FFmpeg drawtext expression and the canvas simulation use the same math
 * so the preview exactly matches the burned-in export.
 */

const CYCLE = 12; // seconds
const MARGIN = 22;
const FONT_SIZE = 68; // px at 1080×1920 export resolution

/**
 * Build the FFmpeg drawtext filter string for the animated watermark.
 * Commas inside if()/mod() calls are escaped as \, so they survive
 * FFmpeg's filter-graph parser (which uses , as a filter separator).
 * Node spawn passes args directly — no shell re-escaping needed.
 */
export function watermarkFilter(): string {
  // Segment t_norm for each 4-second leg
  const seg0 = `mod(t\\,${CYCLE})/${CYCLE / 3}`;          // 0–1 in first leg
  const seg1 = `(mod(t\\,${CYCLE})-${CYCLE/3})/${CYCLE/3}`;// 0–1 in second leg
  const seg2 = `(mod(t\\,${CYCLE})-${(CYCLE*2)/3})/${CYCLE/3}`; // 0–1 in third leg

  // X: BR=(main_w-tw-M)  C=((main_w-tw)/2)  BL=M
  const xBR = `(main_w-tw-${MARGIN})`;
  const xC  = `((main_w-tw)/2)`;
  const xBL = `${MARGIN}`;
  const xExpr =
    `if(lt(mod(t\\,${CYCLE})\\,${CYCLE/3})\\,` +
      `${xBR}+(${xC}-${xBR})*(${seg0})\\,` +
      `if(lt(mod(t\\,${CYCLE})\\,${(CYCLE*2)/3})\\,` +
        `${xC}+(${xBL}-${xC})*(${seg1})\\,` +
        `${xBL}+(${xBR}-${xBL})*(${seg2})))`;

  // Y: BR=BL=(main_h-th-M)  C=((main_h-th)/2)
  const yBot = `(main_h-th-${MARGIN})`;
  const yC   = `((main_h-th)/2)`;
  const yExpr =
    `if(lt(mod(t\\,${CYCLE})\\,${CYCLE/3})\\,` +
      `${yBot}+(${yC}-${yBot})*(${seg0})\\,` +
      `if(lt(mod(t\\,${CYCLE})\\,${(CYCLE*2)/3})\\,` +
        `${yC}+(${yBot}-${yC})*(${seg1})\\,` +
        `${yBot}))`;

  return [
    `drawtext=text='klyp.world'`,
    `font='Arial Bold'`,
    `fontsize=${FONT_SIZE}`,
    `fontcolor=white@0.7`,
    `x=${xExpr}`,
    `y=${yExpr}`,
  ].join(":");
}

/**
 * Canvas position for the preview simulation — same 3-waypoint math as above.
 * `t` is video.currentTime (clip-relative seconds).
 */
export function watermarkCanvasPos(
  t: number,
  W: number,
  H: number,
  textW: number,
  textH: number
): { x: number; y: number } {
  const phase = ((t % CYCLE) + CYCLE) % CYCLE;
  const margin = MARGIN * (W / 1080); // scale margin to preview size
  const segLen = CYCLE / 3;
  const seg = Math.min(2, Math.floor(phase / segLen));
  const tNorm = (phase % segLen) / segLen;

  const positions = [
    { x: W - textW - margin, y: H - textH - margin }, // BR
    { x: (W - textW) / 2,    y: (H - textH) / 2    }, // C
    { x: margin,              y: H - textH - margin  }, // BL
  ];

  const from = positions[seg];
  const to   = positions[(seg + 1) % 3];

  return {
    x: from.x + (to.x - from.x) * tNorm,
    y: from.y + (to.y - from.y) * tNorm,
  };
}

export { FONT_SIZE as WATERMARK_FONT_SIZE };
