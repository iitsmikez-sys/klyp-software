import type { TimedWord } from "./clips";
import type { EditSegment } from "./edit-segments";
import { buildEditorTimeline, type MediaInsert } from "./editor-media.ts";

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
