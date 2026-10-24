/** H.264 requires even dimensions, including after aspect-ratio rounding. */
export function archiveScaleFilter(height: number): string {
  if (![540, 720, 1080].includes(height)) throw new Error("Unsupported archive height");
  return `scale=-2:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2`;
}
