import type { TimedWord } from './clips';

export type CoverageWindow = { start: number; end: number };
export type CoverageSegment = CoverageWindow & {
  actualAudioSeconds: number;
  vodSeconds: number;
  version: string;
  model: string;
  words: TimedWord[];
};

function wellFormed(window: CoverageWindow): boolean {
  return Number.isFinite(window.start) && Number.isFinite(window.end) && window.start >= 0 && window.end > window.start;
}

/** Never infer full-VOD coverage from a partial transcript's word timestamps. */
export function validCoverageSegment(segment: CoverageSegment, vodSeconds: number, version: string, model: string): boolean {
  return wellFormed(segment) && segment.end <= vodSeconds && segment.vodSeconds === vodSeconds &&
    segment.version === version && segment.model === model &&
    Number.isFinite(segment.actualAudioSeconds) && Math.abs(segment.actualAudioSeconds - (segment.end - segment.start)) <= 2 &&
    Array.isArray(segment.words) && segment.words.every(w =>
      Number.isFinite(w.start) && Number.isFinite(w.end) && w.start >= segment.start * 1000 - 2000 &&
      w.end <= segment.end * 1000 + 2000 && w.end >= w.start);
}

/** Subtract cached closed-open intervals from the exact requested VOD ranges. */
export function missingCoverage(requested: CoverageWindow[], cached: CoverageWindow[]): CoverageWindow[] {
  const complete = cached.filter(wellFormed).sort((a, b) => a.start - b.start);
  const missing: CoverageWindow[] = [];
  for (const target of requested.filter(wellFormed)) {
    let cursor = target.start;
    for (const covered of complete) {
      if (covered.end <= cursor || covered.start >= target.end) continue;
      if (covered.start > cursor) missing.push({ start: cursor, end: Math.min(covered.start, target.end) });
      cursor = Math.max(cursor, Math.min(target.end, covered.end));
      if (cursor >= target.end) break;
    }
    if (cursor < target.end) missing.push({ start: cursor, end: target.end });
  }
  return missing;
}

export function reusableWords(segments: Pick<CoverageSegment, 'start' | 'end' | 'words'>[], requested: CoverageWindow[]): TimedWord[] {
  const seen = new Set<string>();
  return segments.flatMap(segment => segment.words.filter(word =>
    word.start >= segment.start * 1000 && word.end <= segment.end * 1000 &&
    requested.some(window => word.start >= window.start * 1000 && word.start < window.end * 1000)))
    .filter(word => {
      const key = `${word.start}:${word.end}:${word.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((a, b) => a.start - b.start);
}
