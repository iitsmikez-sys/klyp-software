/** Convert absolute VOD times to times within a downloaded segment or archived master.
 * Archive jobs floor the original clip start, so an archived source offset can
 * precede the exact saved start by less than a second.
 */
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

/** Ignore old or malformed browser drafts rather than exporting outside the saved clip. */
export function readSavedTrim(value: unknown, originalStart: number, originalEnd: number): { start: number; end: number } {
  const original = { start: originalStart, end: originalEnd };
  if (!value || typeof value !== "object" || Array.isArray(value)) return original;
  const { start, end } = value as Record<string, unknown>;
  if (typeof start !== "number" || typeof end !== "number" || !Number.isFinite(start) || !Number.isFinite(end) ||
      start < originalStart || end > originalEnd || end - start < 0.1 || end - start > 180) return original;
  return { start, end };
}

/** The preview file is the original cut; playback must honor the edited range. */
export function clipTrimPlayback(currentTime: number, start: number, end: number): { time: number; pause: boolean } {
  if (currentTime >= end) return { time: start, pause: true };
  if (currentTime < start) return { time: start, pause: false };
  return { time: currentTime, pause: false };
}
