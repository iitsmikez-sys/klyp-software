import type { TimedWord } from "./clips";
import type { EditSegment } from "./edit-segments";

export type MediaInsert = {
  id: string;
  kind: "image" | "video";
  after: number; // -1 means before the first source section
  duration: number;
};

export type EditorTimelineItem = {
  kind: "source" | "image" | "video";
  start: number;
  end: number;
  sourceIndex?: number;
  sourceStart?: number;
  sourceEnd?: number;
  mediaIndex?: number;
  id?: string;
};

const MEDIA_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const MAX_MEDIA_ITEMS = 8;
export const MAX_MEDIA_SECONDS = 30;
export const MAX_EDITOR_SECONDS = 180;

export function editorMediaPath(userId: string, clipId: string, id: string, kind: "image" | "video"): string {
  if (![userId, clipId, id].every((value) => MEDIA_ID.test(value))) {
    throw new Error("Invalid editor media identity.");
  }
  return `${userId}/${clipId}/editor-${id}.${kind === "image" ? "jpg" : "mp4"}`;
}

export function parseMediaInserts(value: unknown, segments: EditSegment[]): MediaInsert[] {
  if (!Array.isArray(value) || value.length > MAX_MEDIA_ITEMS) throw new Error("Too many imported media items.");
  const ids = new Set<string>();
  const media: MediaInsert[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") throw new Error("Invalid imported media.");
    const { id, kind, after, duration } = item as Record<string, unknown>;
    if (typeof id !== "string" || !MEDIA_ID.test(id) || ids.has(id) ||
        (kind !== "image" && kind !== "video") ||
        typeof after !== "number" || !Number.isInteger(after) || after < -1 || after >= segments.length ||
        typeof duration !== "number" || !Number.isFinite(duration) || duration < 0.1 || duration > MAX_MEDIA_SECONDS) {
      throw new Error("Invalid imported media placement or duration.");
    }
    ids.add(id);
    media.push({ id, kind, after, duration });
  }
  const total = segments.reduce((sum, item) => sum + item.end - item.start, 0) +
    media.reduce((sum, item) => sum + item.duration, 0);
  if (total > MAX_EDITOR_SECONDS + 0.001) throw new Error("Edited clips are capped at 3 minutes.");
  return media;
}

export function buildEditorTimeline(segments: EditSegment[], media: MediaInsert[]): EditorTimelineItem[] {
  const items: EditorTimelineItem[] = [];
  let cursor = 0;
  const addMediaAfter = (index: number) => {
    media.forEach((entry, mediaIndex) => {
      if (entry.after !== index) return;
      items.push({ kind: entry.kind, id: entry.id, mediaIndex, start: cursor, end: cursor + entry.duration });
      cursor += entry.duration;
    });
  };
  addMediaAfter(-1);
  segments.forEach((segment, sourceIndex) => {
    const duration = segment.end - segment.start;
    items.push({ kind: "source", sourceIndex, sourceStart: segment.start, sourceEnd: segment.end,
      start: cursor, end: cursor + duration });
    cursor += duration;
    addMediaAfter(sourceIndex);
  });
  return items;
}

export function timelineItemAt(items: EditorTimelineItem[], time: number): EditorTimelineItem | null {
  if (!items.length) return null;
  const clamped = Math.max(0, Math.min(time, items[items.length - 1].end));
  return items.find((item) => clamped < item.end - 0.001) ?? items[items.length - 1];
}

export function outputTimeForSource(items: EditorTimelineItem[], sourceTime: number): number {
  for (const item of items) {
    if (item.kind !== "source") continue;
    if (sourceTime < item.sourceStart!) return item.start;
    if (sourceTime < item.sourceEnd! - 0.001) return item.start + Math.max(0, sourceTime - item.sourceStart!);
  }
  return items.length ? items[items.length - 1].end : 0;
}

export function mediaAfterSplit<T extends MediaInsert>(media: T[], sourceIndex: number): T[] {
  return media.map((item) => ({ ...item, after: item.after >= sourceIndex ? item.after + 1 : item.after }));
}

export function mediaAfterDelete<T extends MediaInsert>(media: T[], sourceIndex: number): T[] {
  return media.map((item) => ({ ...item, after: item.after >= sourceIndex ? item.after - 1 : item.after }));
}

export function retimeWordsWithMedia(
  words: TimedWord[], clipStartSeconds: number, segments: EditSegment[], media: MediaInsert[],
): TimedWord[] {
  const result: TimedWord[] = [];
  const offsetMs = clipStartSeconds * 1000;
  for (const item of buildEditorTimeline(segments, media)) {
    if (item.kind !== "source") continue;
    const sourceStart = offsetMs + item.sourceStart! * 1000;
    const sourceEnd = offsetMs + item.sourceEnd! * 1000;
    for (const word of words) {
      if (word.start < sourceStart || word.start >= sourceEnd) continue;
      result.push({ text: word.text,
        start: Math.round(item.start * 1000 + word.start - sourceStart),
        end: Math.round(item.start * 1000 + Math.min(word.end, sourceEnd) - sourceStart) });
    }
  }
  return result;
}
