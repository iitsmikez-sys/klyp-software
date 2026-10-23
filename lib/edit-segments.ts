import type { TimedWord } from "./clips";

/** Kept ranges, in seconds relative to the original AI-picked clip. */
export type EditSegment = { start: number; end: number };

const MIN_SEGMENT_SECONDS = 0.1;
const EPSILON = 0.001;

export function parseSegments(value: unknown, clipDuration: number): EditSegment[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    throw new Error("Keep at least one and at most 100 clip sections.");
  }
  if (!Number.isFinite(clipDuration) || clipDuration <= 0 || clipDuration > 180) {
    throw new Error("Invalid source clip duration.");
  }
  const segments: EditSegment[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") throw new Error("Invalid clip section.");
    const { start, end } = item as Record<string, unknown>;
    if (typeof start !== "number" || typeof end !== "number" ||
        !Number.isFinite(start) || !Number.isFinite(end) || start < 0 ||
        end > clipDuration + EPSILON || end - start < MIN_SEGMENT_SECONDS - EPSILON) {
      throw new Error("Clip sections must have valid start and end times.");
    }
    if (segments.length && start < segments[segments.length - 1].end - EPSILON) {
      throw new Error("Clip sections must stay in order without overlaps.");
    }
    segments.push({ start, end: Math.min(end, clipDuration) });
  }
  return segments;
}

export function timelineDuration(segments: EditSegment[]): number {
  return segments.reduce((sum, segment) => sum + segment.end - segment.start, 0);
}

export function splitSegment(segments: EditSegment[], index: number, at: number): EditSegment[] {
  const segment = segments[index];
  if (!segment || !Number.isFinite(at) ||
      at - segment.start < MIN_SEGMENT_SECONDS ||
      segment.end - at < MIN_SEGMENT_SECONDS) return segments;
  const cut = Math.round(at * 1000) / 1000;
  return [
    ...segments.slice(0, index),
    { start: segment.start, end: cut },
    { start: cut, end: segment.end },
    ...segments.slice(index + 1),
  ];
}

export function deleteSegment(segments: EditSegment[], index: number): EditSegment[] {
  if (segments.length <= 1 || !segments[index]) return segments;
  return segments.filter((_, i) => i !== index);
}

/** Trim one kept section without crossing the neighboring kept sections. */
export function trimSegment(
  segments: EditSegment[], index: number, handle: "start" | "end", proposed: number,
  clipDuration: number,
): EditSegment[] {
  const segment = segments[index];
  if (!segment || !Number.isFinite(clipDuration)) return segments;
  const lower = index === 0 ? 0 : segments[index - 1].end;
  const upper = index === segments.length - 1 ? clipDuration : segments[index + 1].start;
  if (!Number.isFinite(proposed) || upper - lower < MIN_SEGMENT_SECONDS) return segments;
  const round = (value: number) => Math.round(value * 100) / 100;
  const next = handle === "start"
    ? { start: round(Math.max(lower, Math.min(proposed, segment.end - MIN_SEGMENT_SECONDS))), end: segment.end }
    : { start: segment.start, end: round(Math.min(upper, Math.max(proposed, segment.start + MIN_SEGMENT_SECONDS))) };
  if (next.start === segment.start && next.end === segment.end) return segments;
  return segments.map((item, itemIndex) => itemIndex === index ? next : item);
}

export function segmentIndexAtSource(segments: EditSegment[], sourceTime: number): number {
  return segments.findIndex((segment, index) =>
    sourceTime >= segment.start - EPSILON &&
    (sourceTime < segment.end - EPSILON ||
      (index === segments.length - 1 && sourceTime <= segment.end + EPSILON))
  );
}

/** Map a time on the shortened timeline to the original preview video's time. */
export function sourceTimeAt(segments: EditSegment[], timelineTime: number): number {
  if (!segments.length) return 0;
  let remaining = Math.max(0, timelineTime);
  for (let i = 0; i < segments.length; i++) {
    const duration = segments[i].end - segments[i].start;
    if (remaining < duration - EPSILON) return segments[i].start + remaining;
    remaining -= duration;
  }
  return segments[segments.length - 1].end;
}

/** A source time in a deleted gap maps to the join between kept sections. */
export function timelineTimeAt(segments: EditSegment[], sourceTime: number): number {
  let elapsed = 0;
  for (const segment of segments) {
    if (sourceTime <= segment.start) return elapsed;
    if (sourceTime < segment.end) return elapsed + sourceTime - segment.start;
    elapsed += segment.end - segment.start;
  }
  return elapsed;
}

/** Convert VOD-absolute words to the shortened output timeline for ASS captions. */
export function retimeWords(
  words: TimedWord[], clipStartSeconds: number, segments: EditSegment[]
): TimedWord[] {
  const output: TimedWord[] = [];
  let outputStartMs = 0;
  const clipStartMs = clipStartSeconds * 1000;
  for (const segment of segments) {
    const sourceStartMs = clipStartMs + segment.start * 1000;
    const sourceEndMs = clipStartMs + segment.end * 1000;
    for (const word of words) {
      if (word.start < sourceStartMs || word.start >= sourceEndMs) continue;
      output.push({
        text: word.text,
        start: Math.max(0, Math.round(outputStartMs + word.start - sourceStartMs)),
        end: Math.round(outputStartMs + Math.min(word.end, sourceEndMs) - sourceStartMs),
      });
    }
    outputStartMs += (segment.end - segment.start) * 1000;
  }
  return output;
}

/** FFmpeg filter graph for a ripple cut from one video/audio source. */
export function buildSegmentFilter(
  segments: EditSegment[], videoFilter?: string, hasAudio = true
): { graph: string; videoLabel: string; audioLabel: string | null } {
  if (segments.length === 0) throw new Error("At least one clip section is required.");
  const parts: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    const { start, end } = segments[i];
    parts.push(`[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v${i}]`);
    if (hasAudio) parts.push(`[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${i}]`);
  }
  const inputs = segments.map((_, i) => `[v${i}]${hasAudio ? `[a${i}]` : ""}`).join("");
  parts.push(`${inputs}concat=n=${segments.length}:v=1:a=${hasAudio ? 1 : 0}[vcat]${hasAudio ? "[acat]" : ""}`);
  if (videoFilter) parts.push(`[vcat]${videoFilter}[vout]`);
  return {
    graph: parts.join(";"),
    videoLabel: videoFilter ? "[vout]" : "[vcat]",
    audioLabel: hasAudio ? "[acat]" : null,
  };
}
