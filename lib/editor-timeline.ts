import type { ClipEditDraftV3, VisualCutaway, TimelineInsert } from "./clip-edit-draft.ts";
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
export type ResolvedInsertSpan = TimelineInsert & {start_ms:number;end_ms:number};
export function composedDuration(draft: Pick<ClipEditDraftV3,'segments'|'inserts'>): number {
 return outputDuration(draft.segments)+(draft.inserts??[]).reduce((sum,item)=>sum+item.duration_ms/1000,0);
}
export function resolveInsertSpans(draft: Pick<ClipEditDraftV3,'segments'|'inserts'>): ResolvedInsertSpan[] {
 let offset=0;const spans:ResolvedInsertSpan[]=[];
 for(const segment of draft.segments){
  offset+=(segment.end_seconds-segment.start_seconds)*1000;
  for(const insert of draft.inserts??[]){if(insert.after_segment_id===segment.id){spans.push({...insert,start_ms:offset,end_ms:offset+insert.duration_ms});offset+=insert.duration_ms;}}
 }
 return spans;
}
export function composedAtOutputTime(draft: Pick<ClipEditDraftV3,'segments'|'inserts'>,seconds:number): {kind:'source';sourceSeconds:number;segment:SourceSegment}|{kind:'insert';span:ResolvedInsertSpan;assetSeconds:number} {
 if(!Number.isFinite(seconds))throw new Error('Invalid output position.');
 let offset=0;
 for(const segment of draft.segments){
  const duration=segment.end_seconds-segment.start_seconds;
  if(seconds<offset+duration)return {kind:'source',sourceSeconds:segment.start_seconds+Math.max(0,seconds-offset),segment};
  offset+=duration;
  for(const insert of draft.inserts??[]){if(insert.after_segment_id!==segment.id)continue;
   if(seconds<offset+insert.duration_ms/1000)return {kind:'insert',span:{...insert,start_ms:Math.round(offset*1000),end_ms:Math.round(offset*1000)+insert.duration_ms},assetSeconds:insert.asset_in_ms/1000+Math.max(0,seconds-offset)};
   offset+=insert.duration_ms/1000;
  }
 }
 const last=draft.segments.at(-1);if(!last)throw new Error('Empty output.');
 return {kind:'source',sourceSeconds:last.end_seconds,segment:last};
}
export function sourceOnlyOutputForSourceSeconds(segments:readonly SourceSegment[],sourceSeconds:number):number {
 let offset=0;for(const segment of segments){if(sourceSeconds<segment.end_seconds)return offset+Math.max(0,sourceSeconds-segment.start_seconds);offset+=segment.end_seconds-segment.start_seconds;}
 return offset;
}
export function composedOutputForSourceOnlyTime(draft:Pick<ClipEditDraftV3,'segments'|'inserts'>,seconds:number):number {
 let sourceOffset=0,composedOffset=0;
 for(const segment of draft.segments){const length=segment.end_seconds-segment.start_seconds;
  if(seconds<sourceOffset+length-.000001)return composedOffset+Math.max(0,seconds-sourceOffset);
  sourceOffset+=length;composedOffset+=length;
  for(const insert of draft.inserts??[])if(insert.after_segment_id===segment.id)composedOffset+=insert.duration_ms/1000;
 }
 return composedOffset;
}
/** Output milliseconds and the imported-media offset at this fragment's start. */
export type ResolvedCutawaySpan = VisualCutaway & { start_ms: number; end_ms: number };
/** Resolve each surviving source intersection without changing persisted anchors or IDs. */
export function resolveCutawaySpans(draft: ClipEditDraftV3): ResolvedCutawaySpan[] {
 const spans: ResolvedCutawaySpan[] = [];
 let outputOffset = 0;
 for (const segment of draft.segments) {
  const sourceStart = segment.start_seconds * 1000;
  const sourceEnd = segment.end_seconds * 1000;
  for (const cutaway of draft.cutaways) {
   const start = Math.max(sourceStart, cutaway.source_start_ms);
   const end = Math.min(sourceEnd, cutaway.source_end_ms);
   if (end > start) spans.push({ ...cutaway, focal_point: { ...cutaway.focal_point }, start_ms: outputOffset + start - sourceStart, end_ms: outputOffset + end - sourceStart, asset_in_ms: cutaway.asset_in_ms + start - cutaway.source_start_ms });
  }
  outputOffset += sourceEnd - sourceStart;
  for(const insert of draft.inserts??[])if(insert.after_segment_id===segment.id)outputOffset+=insert.duration_ms;
 }
 return spans.sort((a, b) => a.start_ms - b.start_ms);
}
/** Half-open boundaries match source segments and caption lookup. */
export function cutawayAtOutputTime(spans: readonly ResolvedCutawaySpan[], seconds: number): ResolvedCutawaySpan | null {
 if (!Number.isFinite(seconds) || seconds < 0) return null;
 return spans.find(span => seconds * 1000 >= span.start_ms && seconds * 1000 < span.end_ms) ?? null;
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
export function outputSpansForSourceCue(segments: readonly SourceSegment[], cue: Pick<CaptionCue, "start_ms" | "end_ms">, inserts:readonly TimelineInsert[]=[]): { start_ms: number; end_ms: number }[] {
  let offset = 0;
  const spans = [];
  for (const s of segments) {
    const start = Math.max(s.start_seconds * 1000, cue.start_ms);
    const end = Math.min(s.end_seconds * 1000, cue.end_ms);
    if (end > start) spans.push({ start_ms: offset + start - s.start_seconds * 1000, end_ms: offset + end - s.start_seconds * 1000 });
    offset += (s.end_seconds - s.start_seconds) * 1000;
    for(const insert of inserts)if(insert.after_segment_id===s.id)offset+=insert.duration_ms;
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
