import { outputDuration, sourceAtOutputTime, type SourceSegment } from './editor-timeline.ts';
import type { TimelineInsert } from './clip-edit-draft.ts';
import type { TimedWord } from './clips.ts';
import type { VerticalLayoutV1 } from './vertical-layout.ts';

export type FocusMode = 'gameplay' | 'reaction';
export type FocusEvent = { id: string; source_ms: number; mode: FocusMode };
export type FocusSpan = { start_ms: number; end_ms: number; mode: FocusMode };
export const MAX_FOCUS_EVENTS = 12;

export function validateFocusEvents(input: unknown, clipStartSeconds: number, clipEndSeconds: number): FocusEvent[] {
  if (!Array.isArray(input) || input.length > MAX_FOCUS_EVENTS) throw new Error('Keep at most 12 focus changes.');
  const ids = new Set<string>();
  let previous = -Infinity;
  return input.map((value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid focus change.');
    const event = value as Record<string, unknown>;
    if (typeof event.id !== 'string' || !event.id.trim() || event.id.length > 120 || ids.has(event.id) ||
        typeof event.source_ms !== 'number' || !Number.isFinite(event.source_ms) ||
        event.source_ms < clipStartSeconds * 1000 || event.source_ms >= clipEndSeconds * 1000 ||
        event.source_ms - previous < 250 || (event.mode !== 'gameplay' && event.mode !== 'reaction')) {
      throw new Error('Invalid focus change.');
    }
    ids.add(event.id);
    previous = event.source_ms;
    return { id: event.id, source_ms: event.source_ms, mode: event.mode } as FocusEvent;
  });
}

/** Markers stay attached to VOD moments; markers in deleted footage have no effect. */
export function resolveFocusSpans(events: readonly FocusEvent[], segments: readonly SourceSegment[], inserts:readonly TimelineInsert[]=[]): FocusSpan[] {
  const kept = events.filter(event => segments.some(segment => event.source_ms >= segment.start_seconds * 1000 && event.source_ms < segment.end_seconds * 1000));
  const spans: FocusSpan[] = [];
  let outputStart = 0;
  let active: FocusMode = 'gameplay';
  for (const segment of segments) {
    const start = segment.start_seconds * 1000;
    const end = segment.end_seconds * 1000;
    let cursor = start;
    for (const event of kept) {
      if (event.source_ms < start || event.source_ms >= end) continue;
      if (event.source_ms > cursor) spans.push({ start_ms: outputStart + cursor - start, end_ms: outputStart + event.source_ms - start, mode: active });
      active = event.mode;
      cursor = event.source_ms;
    }
    if (end > cursor) spans.push({ start_ms: outputStart + cursor - start, end_ms: outputStart + end - start, mode: active });
    outputStart += end - start;
    for(const insert of inserts)if(insert.after_segment_id===segment.id){spans.push({start_ms:outputStart,end_ms:outputStart+insert.duration_ms,mode:active});outputStart+=insert.duration_ms;}
  }
  return spans.reduce<FocusSpan[]>((merged, span) => {
    const prior = merged.at(-1);
    if (prior && prior.mode === span.mode && prior.end_ms === span.start_ms) prior.end_ms = span.end_ms;
    else merged.push({ ...span });
    return merged;
  }, []);
}

export function focusAtOutputTime(spans: readonly FocusSpan[], seconds: number): FocusMode {
  return spans.find(span => seconds * 1000 >= span.start_ms && seconds * 1000 < span.end_ms)?.mode ?? spans.at(-1)?.mode ?? 'gameplay';
}

export function splitCuesForFocus<T extends { id: string; start_ms: number; end_ms: number; text: string }>(cues: readonly T[], spans: readonly FocusSpan[]) {
  return cues.flatMap(cue => spans.flatMap((span, index) => {
    const start = Math.max(cue.start_ms, span.start_ms), end = Math.min(cue.end_ms, span.end_ms);
    return end > start ? [{ ...cue, id: `${cue.id}:focus:${index}`, start_ms: start, end_ms: end, mode: span.mode }] : [];
  }));
}

/** A reaction brings the facecam forward without mutating the saved region boxes. */
export function layoutForFocus(base: VerticalLayoutV1 | null, mode: FocusMode): VerticalLayoutV1 | null {
  if (!base) return null;
  if (mode !== 'reaction' || !base.facecam) return { ...base, focus: undefined };
  const { chat: _chat, ...withoutChat } = base;
  return { ...withoutChat, arrangement: 'facecam_top', focus: 'reaction' };
}

export function outputSecondsForSourceMs(segments: readonly SourceSegment[], sourceMs: number): number | null {
  let offset = 0;
  for (const segment of segments) {
    if (sourceMs >= segment.start_seconds * 1000 && sourceMs < segment.end_seconds * 1000) return offset + sourceMs / 1000 - segment.start_seconds;
    offset += segment.end_seconds - segment.start_seconds;
  }
  return null;
}

export function setFocusAtOutputTime(events: readonly FocusEvent[], segments: readonly SourceSegment[], seconds: number, mode: FocusMode, id: string, clipStartSeconds: number, clipEndSeconds: number): FocusEvent[] {
  if (!Number.isFinite(seconds) || seconds < 0 || seconds >= outputDuration(segments)) throw new Error('Place the playhead inside the clip.');
  const sourceMs = Math.round(sourceAtOutputTime(segments, seconds) * 1000);
  const next = events.filter(event => Math.abs(event.source_ms - sourceMs) > 250);
  next.push({ id, source_ms: sourceMs, mode });
  return validateFocusEvents(next.sort((a, b) => a.source_ms - b.source_ms), clipStartSeconds, clipEndSeconds);
}

/** Cheap, transparent hints from the decoded waveform and transcript; never applied automatically. */
export function suggestFocusEvents(segments: readonly SourceSegment[], peaks: readonly number[] | null, words: readonly TimedWord[]): FocusEvent[] {
  const duration = outputDuration(segments);
  if (duration < 2) return [];
  const candidates: number[] = [];
  if (peaks?.length) {
    const sorted = [...peaks].sort((a, b) => a - b);
    const baseline = sorted[Math.floor(sorted.length * .75)] || 0;
    peaks.forEach((peak, index) => {
      const second = index * duration / peaks.length;
      if (peak >= Math.max(.65, baseline * 1.8) && second < duration - 1) candidates.push(second);
    });
  }
  for (const word of words) {
    if (!/!|^(wow|clutch|insane|what|no|yes|oh|let's)$/i.test(word.text.trim())) continue;
    const second = outputSecondsForSourceMs(segments, word.start);
    if (second !== null && second < duration - 1) candidates.push(second);
  }
  const selected: number[] = [];
  for (const second of candidates.sort((a, b) => a - b)) {
    if (second < .25 || selected.some(other => Math.abs(second - other) < 4)) continue;
    selected.push(second);
    if (selected.length === 3) break;
  }
  return selected.flatMap((second, index) => {
    const reset = Math.min(second + 3, duration - .25);
    if (reset - second < .5) return [];
    return [
      { id: `suggestion-${index}-reaction`, source_ms: Math.round(sourceAtOutputTime(segments, second) * 1000), mode: 'reaction' as const },
      { id: `suggestion-${index}-gameplay`, source_ms: Math.round(sourceAtOutputTime(segments, reset) * 1000), mode: 'gameplay' as const },
    ];
  });
}
