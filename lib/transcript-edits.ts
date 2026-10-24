import type { TimedWord } from "./clips";
import type { EditSegment } from "./edit-segments";
import { buildEditorTimeline, type MediaInsert } from "./editor-media.ts";
import { outputDuration, outputSpansForSourceCue, validateSegments, type SourceSegment } from "./editor-timeline.ts";

export type CleanupCandidate = { kind: "filler" | "pause"; start_seconds: number; end_seconds: number; label: string };
const FILLERS = new Set(["um", "uh", "erm", "hmm"]);

/** Suggestions stay in source time so later edits cannot move them onto other words. */
export function suggestTranscriptCleanup(
  words: TimedWord[], clipStartSeconds: number, segments: SourceSegment[],
  peaks: number[] | null, previewDuration: number,
): CleanupCandidate[] {
  if (!Number.isFinite(clipStartSeconds) || !segments.length || !Array.isArray(words)) return [];
  const sorted = [...words].filter(word => Number.isFinite(word.start) && Number.isFinite(word.end) && word.end > word.start).sort((a, b) => a.start - b.start);
  const output: CleanupCandidate[] = [];
  for (let i = 0; i < sorted.length && output.length < 12; i++) {
    const word = sorted[i];
    const label = word.text.toLowerCase().replace(/^[^a-z]+|[^a-z]+$/g, "");
    const start = word.start / 1000, end = word.end / 1000;
    const segment = start >= clipStartSeconds ? segments.find(item => start - item.start_seconds >= 0.12 && item.end_seconds - end >= 0.12) : undefined;
    if (segment && FILLERS.has(label) && end - start >= 0.1 && end - start <= 0.8 &&
        (i === 0 || sorted[i - 1].end <= word.start) && (i === sorted.length - 1 || word.end <= sorted[i + 1].start)) {
      output.push({ kind: "filler", start_seconds: start, end_seconds: end, label: word.text });
    }
    if (i + 1 >= sorted.length || !peaks || peaks.length < 8 || !Number.isFinite(previewDuration) || previewDuration <= 0) continue;
    const gapStart = Math.round((end + 0.12) * 100) / 100;
    const gapEnd = Math.round((sorted[i + 1].start / 1000 - 0.12) * 100) / 100;
    if (gapEnd - gapStart < 0.8 || !segments.some(item => gapStart >= item.start_seconds && gapEnd <= item.end_seconds)) continue;
    const spans = outputSpansForSourceCue(segments, { start_ms: gapStart * 1000, end_ms: gapEnd * 1000 });
    if (spans.length !== 1 || spans[0].end_ms - spans[0].start_ms < 800) continue;
    const first = Math.max(0, Math.floor(spans[0].start_ms / 1000 / previewDuration * peaks.length));
    const last = Math.min(peaks.length, Math.ceil(spans[0].end_ms / 1000 / previewDuration * peaks.length));
    const samples = peaks.slice(first, last);
    if (samples.length >= 2 && samples.every(value => Number.isFinite(value) && value <= 0.025)) {
      output.push({ kind: "pause", start_seconds: gapStart, end_seconds: gapEnd, label: "Quiet pause" });
    }
  }
  return output;
}

/** Apply reviewed, nonoverlapping source cuts as one undoable edit. */
export function applyTranscriptCleanup(segments: SourceSegment[], candidates: CleanupCandidate[]): SourceSegment[] {
  if (!candidates.length) return segments;
  const cuts = [...candidates].sort((a, b) => a.start_seconds - b.start_seconds);
  if (cuts.some((cut, i) => !Number.isFinite(cut.start_seconds) || !Number.isFinite(cut.end_seconds) || cut.end_seconds - cut.start_seconds < 0.1 || (i > 0 && cut.start_seconds < cuts[i - 1].end_seconds))) return segments;
  const next: SourceSegment[] = [];
  const used = new Set(segments.map(item => item.id));
  for (const segment of segments) {
    let cursor = segment.start_seconds;
    let suffix = 0;
    const nextId = () => {
      if (suffix++ === 0) return segment.id;
      let candidate: string;
      do { candidate = `${segment.id.slice(0, 98)}-clean-${suffix++}`; } while (used.has(candidate));
      used.add(candidate);
      return candidate;
    };
    for (const cut of cuts) {
      if (cut.start_seconds < segment.start_seconds || cut.end_seconds > segment.end_seconds) continue;
      if (cut.start_seconds - cursor >= 0.1) next.push({ id: nextId(), start_seconds: cursor, end_seconds: cut.start_seconds });
      cursor = cut.end_seconds;
    }
    if (segment.end_seconds - cursor >= 0.1) next.push({ id: nextId(), start_seconds: cursor, end_seconds: segment.end_seconds });
  }
  if (!next.length || next.length > 64 || outputDuration(next) < 0.1) return segments;
  try { return validateSegments(next); } catch { return segments; }
}

export type SourceRange = { start: number; end: number };
const MIN_SECTION = 0.1;

/** Remove source time selected from the transcript while keeping media attached. */
export function removeTranscriptRange<T extends MediaInsert>(
  segments: EditSegment[], media: T[], start: number, end: number,
): { segments: EditSegment[]; media: T[] } | null {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < MIN_SECTION ||
    start < 0 || segments.length === 0) return null;

  const next: EditSegment[] = [];
  const afterIndex: number[] = [];
  const removed: Array<{ start: number; end: number }> = [];
  const oldTimeline = buildEditorTimeline(segments, media);
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    const cutStart = Math.max(start, segment.start);
    const cutEnd = Math.min(end, segment.end);
    if (cutEnd > cutStart) {
      const timeline = oldTimeline.find((item) => item.kind === "source" && item.sourceIndex === index)!;
      removed.push({ start: timeline.start + cutStart - segment.start,
        end: timeline.start + cutEnd - segment.start });
      if (cutStart - segment.start >= MIN_SECTION) next.push({ start: segment.start, end: cutStart });
      if (segment.end - cutEnd >= MIN_SECTION) next.push({ start: cutEnd, end: segment.end });
    } else next.push(segment);
    afterIndex.push(next.length - 1);
  }
  if (!removed.length || !next.length || next.length > 100) return null;

  const newDuration = buildEditorTimeline(next, media.map((item) => ({ ...item,
    after: item.after < 0 ? -1 : afterIndex[item.after] ?? next.length - 1,
  }))).at(-1)?.end ?? 0;
  const moveTime = (at: number) => at - removed.reduce((sum, range) =>
    sum + Math.max(0, Math.min(at, range.end) - range.start), 0);
  const moved = media.map((item) => {
    const after = item.after < 0 ? -1 : afterIndex[item.after] ?? next.length - 1;
    if (item.placement !== "overlay") return { ...item, after };
    const duration = Math.min(item.duration, newDuration);
    return { ...item, after, duration,
      at: Math.max(0, Math.min(moveTime(item.at ?? 0), newDuration - duration)) };
  }) as T[];
  return { segments: next, media: moved };
}

/** Speech gaps are suggested only when the decoded preview waveform is quiet. */
export function findQuietPauses(
  words: TimedWord[], clipStartSeconds: number, segments: EditSegment[],
  peaks: number[], previewDuration: number, previewLeadSeconds = 0,
): SourceRange[] {
  if (words.length < 2 || peaks.length < 8 || !Number.isFinite(previewDuration) || previewDuration <= 0) return [];
  const output: SourceRange[] = [];
  for (let i = 0; i < words.length - 1 && output.length < 8; i++) {
    const start = Math.round((words[i].end / 1000 - clipStartSeconds + 0.1) * 100) / 100;
    const end = Math.round((words[i + 1].start / 1000 - clipStartSeconds - 0.1) * 100) / 100;
    if (end - start < 1.2 || !segments.some((part) => start >= part.start && end <= part.end)) continue;
    const first = Math.max(0, Math.floor((start + previewLeadSeconds) / previewDuration * peaks.length));
    const last = Math.min(peaks.length, Math.ceil((end + previewLeadSeconds) / previewDuration * peaks.length));
    const samples = peaks.slice(first, last);
    if (samples.length < 2 || samples.some((value) => !Number.isFinite(value) || value > 0.08)) continue;
    const average = samples.reduce((sum, value) => sum + value, 0) / samples.length;
    if (average <= 0.025) output.push({ start, end });
  }
  return output;
}
