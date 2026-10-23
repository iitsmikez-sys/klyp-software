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

/** Keep each trim handle inside the original cut, with at least 0.1s between them. */
export function updateClipTrim(
  originalStart: number,
  originalEnd: number,
  start: number,
  end: number,
  handle: "start" | "end",
  proposed: number,
): { start: number; end: number } {
  if (![originalStart, originalEnd, start, end, proposed].every(Number.isFinite) ||
      originalEnd - originalStart < 0.1 || start < originalStart || end > originalEnd || end <= start) {
    throw new RangeError("Invalid trim range.");
  }
  const round = (value: number) => Math.round(value * 100) / 100;
  if (handle === "start") {
    return { start: round(Math.max(originalStart, Math.min(proposed, round(end - 0.1)))), end };
  }
  return { start, end: round(Math.min(originalEnd, Math.max(proposed, round(start + 0.1)))) };
}

