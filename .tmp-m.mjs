import fs from "node:fs";
let s = fs.readFileSync("lib/caption-template-motion.ts", "utf8"); const crlf = s.includes("\r\n"); s = s.replace(/\r\n/g, "\n");
const rep = (a, b) => { if (!s.includes(a)) throw new Error("missing " + a.slice(0, 60)); s = s.split(a).join(b); };
rep(`/** Clean captions fade in over a third of a second; nothing else moves. */
export const CLEAN_FADE_MS = 330;`, `/** Clean captions fade in while drifting up a little: 28px (at 1920 tall) over 350ms. */
export const CLEAN_RISE_PX = 28;
export const CLEAN_RISE_MS = 350;`);
rep(`  if (style === "CLEAN") return { scale: 1, yOffset: 0, alpha: progress(elapsedMs, CLEAN_FADE_MS) };`,
    `  if (style === "CLEAN") return {
    scale: 1, yOffset: CLEAN_RISE_PX * (1 - progress(elapsedMs, CLEAN_RISE_MS)),
    alpha: progress(elapsedMs, CLEAN_RISE_MS),
  };`);
rep("  if (style === \"CLEAN\") return `{\\fad(${CLEAN_FADE_MS},0)}`;\n", "");
rep(`export function captionAssMotion(
  style: CaptionStyle, width: number, height: number, position: CaptionPosition,
): string {`, `export function captionAssMotion(
  style: CaptionStyle, width: number, height: number, position: CaptionPosition, bottomInset = 0,
): string {`);
rep(`  if (style === "SLIDE") {
    const scale = height / 1920;
    const y = position === "TOP" ? 400 * scale : position === "CENTER" ? height / 2 : height - 80 * scale;
    const x = width / 2;
    return \`{\\move(\${Math.round(x)},\${Math.round(y + 55 * scale)},\${Math.round(x)},\${Math.round(y)},0,220)\\fad(180,0)}\`;
  }
  return "";`, `  if (style === "SLIDE" || style === "CLEAN") {
    const scale = height / 1920;
    const y = position === "TOP" ? 400 * scale : position === "CENTER" ? height / 2 : height - 80 * scale - bottomInset;
    const x = width / 2;
    const [rise, ms, fade] = style === "SLIDE" ? [55, 220, 180] : [CLEAN_RISE_PX, CLEAN_RISE_MS, CLEAN_RISE_MS];
    return \`{\\move(\${Math.round(x)},\${Math.round(y + rise * scale)},\${Math.round(x)},\${Math.round(y)},0,\${ms})\\fad(\${fade},0)}\`;
  }
  return "";`);
rep(`  if (style === "SLIDE") {
    const rise = Math.round(55 * height / 1920);
    return \`{\\an5\\move(\${x},\${y + rise},\${x},\${y},0,220)\\fad(180,0)}\`;
  }`, `  if (style === "SLIDE" || style === "CLEAN") {
    const clean = style === "CLEAN";
    const rise = Math.round((clean ? CLEAN_RISE_PX : 55) * height / 1920);
    return \`{\\an5\\move(\${x},\${y + rise},\${x},\${y},0,\${clean ? CLEAN_RISE_MS : 220})\\fad(\${clean ? CLEAN_RISE_MS : 180},0)}\`;
  }`);
fs.writeFileSync("lib/caption-template-motion.ts", crlf ? s.replace(/\n/g, "\r\n") : s);
