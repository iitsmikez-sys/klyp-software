export type SourceSegment = { id: string; start_seconds: number; end_seconds: number };
export type CaptionCue = { id: string; start_ms: number; end_ms: number; text: string };
const EPSILON = 1e-9;
/** Reject rather than reorder: source order is part of the saved edit contract. */
export function validateSegments(input: unknown, start = 0, end = Infinity): SourceSegment[] {
  if (!Array.isArray(input) || !input.length || input.length > 64) throw new Error("Keep 1–64 segments.");
  const ids = new Set<string>();
  let previousEnd = start;
  const segments = input.map((s: SourceSegment) => {
    if (!s || typeof s.id !== "string" || !s.id.trim() || s.id.length > 120 || ids.has(s.id) ||
        !Number.isFinite(s.start_seconds) || !Number.isFinite(s.end_seconds) ||
        s.start_seconds < previousEnd || s.end_seconds > end || s.end_seconds - s.start_seconds < 0.1 - EPSILON) throw new Error("Invalid source segments.");
    ids.add(s.id);
    previousEnd = s.end_seconds;
    return { id: s.id, start_seconds: s.start_seconds, end_seconds: s.end_seconds };
  });
  if (outputDuration(segments) > 180 + EPSILON) throw new Error("Output must be at most 3 minutes.");
  return segments;
}
export function outputDuration(segments: readonly SourceSegment[]): number {
  return segments.reduce((sum, s) => sum + s.end_seconds - s.start_seconds, 0);
}
/** Clamp finite positions; an internal boundary belongs to the next segment. */
export function sourceAtOutputTime(segments: readonly SourceSegment[], seconds: number): number {
  if (!segments.length || !Number.isFinite(seconds)) throw new Error("Invalid output position.");
  let remaining = Math.max(0, seconds);
  for (const s of segments) {
    const duration = s.end_seconds - s.start_seconds;
    if (remaining < duration) return s.start_seconds + remaining;
    remaining -= duration;
  }
  return segments[segments.length - 1].end_seconds;
}
export function outputSpansForSourceCue(segments: readonly SourceSegment[], cue: Pick<CaptionCue, "start_ms" | "end_ms">): { start_ms: number; end_ms: number }[] {
  let offset = 0;
  const spans = [];
  for (const s of segments) {
    const start = Math.max(s.start_seconds * 1000, cue.start_ms);
    const end = Math.min(s.end_seconds * 1000, cue.end_ms);
    if (end > start) spans.push({ start_ms: offset + start - s.start_seconds * 1000, end_ms: offset + end - s.start_seconds * 1000 });
    offset += (s.end_seconds - s.start_seconds) * 1000;
  }
  return spans;
}
function selected(segments: readonly SourceSegment[], id: string): SourceSegment {
  const segment = segments.find(s => s.id === id);
  if (!segment) throw new Error("Segment not found.");
  return segment;
}
export function splitSegment(segments: readonly SourceSegment[], id: string, sourceSeconds: number): SourceSegment[] {
  const segment = selected(segments, id);
  if (!Number.isFinite(sourceSeconds) || sourceSeconds - segment.start_seconds < 0.1 - EPSILON || segment.end_seconds - sourceSeconds < 0.1 - EPSILON) throw new Error("Split must leave playable segments.");
  let suffix = 1;
  const childId = () => {
    const ending = `-split-${suffix}`;
    return `${id.slice(0, 120 - ending.length)}${ending}`;
  };
  while (segments.some(s => s.id === childId())) suffix++;
  return validateSegments(segments.flatMap(s => s.id === id ? [{ ...s, end_seconds: sourceSeconds }, { ...s, id: childId(), start_seconds: sourceSeconds }] : [{ ...s }]));
}
export function deleteSegment(segments: readonly SourceSegment[], id: string): SourceSegment[] {
  selected(segments, id);
  return validateSegments(segments.filter(s => s.id !== id));
}
export function trimSegment(segments: readonly SourceSegment[], id: string, start: number, end: number): SourceSegment[] {
  const segment = selected(segments, id);
  if (start < segment.start_seconds || end > segment.end_seconds) throw new Error("Trim must stay inside the selected segment.");
  return validateSegments(segments.map(s => s.id === id ? { ...s, start_seconds: start, end_seconds: end } : s));
}
