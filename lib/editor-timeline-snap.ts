/**
 * Snapping for the editor timeline: a dragged edge clicks into the playhead, the clip ends and every cut,
 * insert and overlay edge when it comes within a few pixels. All positions are output seconds.
 */
type Segment = { id: string; start_seconds: number; end_seconds: number };
type Span = { start_ms: number; end_ms: number };
type Insert = Span & { after_segment_id: string };

export const SNAP_PX = 8;

export function timelineSnapPoints(input: { segments: Segment[]; inserts: Insert[]; cutaways: Span[]; duration: number; outputTime: number }): number[] {
  const points = [0, input.duration, input.outputTime];
  let at = 0;
  for (const segment of input.segments) {
    points.push(at);
    at += segment.end_seconds - segment.start_seconds;
    points.push(at);
    for (const item of input.inserts.filter((i) => i.after_segment_id === segment.id)) {
      points.push(at, at + (item.end_ms - item.start_ms) / 1000);
      at += (item.end_ms - item.start_ms) / 1000;
    }
  }
  for (const c of input.cutaways) points.push(c.start_ms / 1000, c.end_ms / 1000);
  return points;
}

/** The nearest point within `pixels` of `seconds`, or the original position. */
export function nearestSnap(points: number[], seconds: number, pixelsPerSecond: number, pixels = SNAP_PX): { value: number; hit: boolean } {
  let best = seconds, gap = pixels / Math.max(pixelsPerSecond, 1e-9), hit = false;
  for (const point of points) {
    const distance = Math.abs(point - seconds);
    if (distance <= gap) { gap = distance; best = point; hit = true; }
  }
  return { value: best, hit };
}
