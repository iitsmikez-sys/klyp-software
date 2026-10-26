"use client";

import { useState } from 'react';
import { outputSecondsForSourceMs, setFocusAtOutputTime, suggestFocusEvents, type FocusEvent } from '@/lib/editor-focus';
import type { SourceSegment } from '@/lib/editor-timeline';
import type { TimedWord } from '@/lib/clips';
import type { VerticalLayoutV1 } from '@/lib/vertical-layout';

export default function EditorFocusControls({ layout, events, segments, words, peaks, outputTime, clipStart, clipEnd, onChange, onSeek }: {
  layout: VerticalLayoutV1 | null;
  events: FocusEvent[];
  segments: SourceSegment[];
  words: TimedWord[];
  peaks: number[] | null;
  outputTime: number;
  clipStart: number;
  clipEnd: number;
  onChange: (events: FocusEvent[]) => void;
  onSeek: (seconds: number) => void;
}) {
  const [suggestions, setSuggestions] = useState<FocusEvent[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const add = (mode: 'gameplay' | 'reaction') => {
    try {
      onChange(setFocusAtOutputTime(events, segments, outputTime, mode, crypto.randomUUID(), clipStart, clipEnd));
      setMessage(null);
    } catch (error) { setMessage((error as Error).message); }
  };
  const accept = (index: number) => {
    try {
      let next = events;
      for (const suggestion of suggestions.slice(index, index + 2)) {
        const time = outputSecondsForSourceMs(segments, suggestion.source_ms);
        if (time === null) continue;
        next = setFocusAtOutputTime(next, segments, time, suggestion.mode, crypto.randomUUID(), clipStart, clipEnd);
      }
      onChange(next);
      setSuggestions(current => current.filter((_, position) => position !== index && position !== index + 1));
      setMessage('Suggestion added. Preview it, then save your draft.');
    } catch (error) { setMessage((error as Error).message); }
  };
  return <section className="editor-focus-controls" aria-label="Focus changes">
    <h3>Focus changes</h3>
    <p>Keep gameplay large for the play; bring the facecam forward for the reaction. Changes follow the original stream moment when you cut footage.</p>
    {!layout?.facecam && <p role="status">Choose a facecam layout above to enable focus changes. You can remove saved changes below.</p>}
    {layout?.facecam && <>
      <div className="editor-focus-actions" role="group" aria-label="Add focus change at playhead">
        <button type="button" onClick={() => add('gameplay')}>Focus gameplay here</button>
        <button type="button" onClick={() => add('reaction')}>Focus reaction here</button>
      </div>
      <p>Playhead: {outputTime.toFixed(1)}s · at most 12 changes</p>
    </>}
    {events.length > 0 && <ol className="editor-focus-list" aria-label="Saved focus changes">{events.map(event => {
        const time = outputSecondsForSourceMs(segments, event.source_ms);
        return <li key={event.id}><button type="button" onClick={() => time !== null && onSeek(time)} disabled={time === null}>{time === null ? 'Removed footage' : `${time.toFixed(1)}s`} · {event.mode === 'reaction' ? 'Reaction' : 'Gameplay'}</button><button type="button" aria-label={`Remove ${event.mode} focus change at ${time?.toFixed(1) ?? 'removed'} seconds`} onClick={() => onChange(events.filter(item => item.id !== event.id))}>Remove</button></li>;
    })}</ol>}
    {layout?.facecam && <>
      <button type="button" className="editor-focus-suggest" onClick={() => { const proposed = suggestFocusEvents(segments, peaks, words); setSuggestions(proposed); setMessage(proposed.length ? 'Audio and transcript hints only. Review each suggestion before adding it.' : 'No strong reaction hints found. Add changes manually at the playhead.'); }}>Suggest reaction moments</button>
      {suggestions.length > 0 && <div className="editor-focus-suggestions" aria-label="Suggested focus changes">{Array.from({ length: suggestions.length / 2 }, (_, i) => {
        const index = i * 2, at = outputSecondsForSourceMs(segments, suggestions[index].source_ms);
        return <div key={suggestions[index].id}><span>Reaction near {at?.toFixed(1) ?? '?'}s, then back to gameplay</span><button type="button" onClick={() => accept(index)}>Use suggestion</button></div>;
      })}</div>}
    </>}
    {message && <p role="status">{message}</p>}
  </section>;
}
