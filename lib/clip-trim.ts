/** Convert absolute VOD times to times within a downloaded segment or archived master. */
export function clipSeekRange(
  selectedStart: number,
  selectedEnd: number,
  sourceOffset: number,
  originalEnd?: number,
): { start: number; end: number } {
  if (![selectedStart, selectedEnd, sourceOffset].every(Number.isFinite) ||
      selectedStart < sourceOffset || selectedEnd <= selectedStart ||
      (originalEnd !== undefined && (!Number.isFinite(originalEnd) || selectedEnd > originalEnd))) {
    throw new RangeError("Selected trim is outside the saved clip.");
  }
  return { start: selectedStart - sourceOffset, end: selectedEnd - sourceOffset };
}
