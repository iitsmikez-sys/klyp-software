"use client";

import { useState } from 'react';
import type { SavedClip } from '@/lib/clip-ui';
import { outputSpansForSourceCue, type SourceSegment } from '@/lib/editor-timeline';
import type { TimelineInsert } from '@/lib/clip-edit-draft';
import type { CleanupCandidate } from '@/lib/transcript-edits';
import { groupTranscriptParagraphs, wordMatchingQuery } from '@/lib/transcript-paragraphs';

function clipTime(milliseconds: number, startSeconds: number): string {
  const seconds = Math.floor(Math.max(0, milliseconds / 1000 - startSeconds));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export default function EditorTranscript({ clip, segments, inserts, time, onSeek, cleanup, onApplyCleanup, canEdit }: {
  clip: SavedClip;
  segments: SourceSegment[];
  inserts?: TimelineInsert[];
  time: number;
  onSeek: (time: number) => void;
  cleanup: CleanupCandidate[];
  onApplyCleanup: (items: CleanupCandidate[]) => void;
  canEdit: boolean;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const key = (item: CleanupCandidate) => `${item.start_seconds}:${item.end_seconds}`;
  const chosen = cleanup.filter(item => selected.includes(key(item)));
  const saved = chosen.reduce((sum, item) => sum + item.end_seconds - item.start_seconds, 0);
  const paragraphs = groupTranscriptParagraphs(clip.words ?? [], word => outputSpansForSourceCue(segments, { start_ms: word.start, end_ms: word.end }, inserts).length > 0);
  const matches = paragraphs.filter(paragraph => paragraph.text.toLowerCase().includes(query.toLowerCase()));

  return <aside className="editor-transcript">
    <div className="editor-panel-heading"><h2>Transcript</h2><span>Click a paragraph to play</span></div>
    <input aria-label="Search transcript" placeholder="Search transcript…" value={query} onChange={event => setQuery(event.target.value)} />
    <div className="editor-transcript-lines">
      {matches.map(paragraph => {
        const spans = outputSpansForSourceCue(segments, paragraph, inserts);
        const matchedWord = wordMatchingQuery(paragraph, query);
        const seekSpans = matchedWord ? outputSpansForSourceCue(segments, { start_ms: matchedWord.start, end_ms: matchedWord.end }, inserts) : spans;
        const active = spans.some(span => time * 1000 >= span.start_ms && time * 1000 < span.end_ms);
        return <button key={`${paragraph.start_ms}:${paragraph.end_ms}`} type="button" disabled={!seekSpans.length} aria-current={active ? 'true' : undefined} onClick={() => onSeek(seekSpans[0].start_ms / 1000)}>
          <time>[{clipTime(paragraph.start_ms, clip.start_seconds)}–{clipTime(paragraph.end_ms, clip.start_seconds)}]</time>
          <span>{paragraph.text}</span>
        </button>;
      })}
      {!paragraphs.length && <p>{clip.words?.length ? 'No transcript words remain in this edit.' : 'No timed transcript was saved for this clip. Video and hook editing are available.'}</p>}
      {!!paragraphs.length && !matches.length && <p>No matching transcript paragraphs.</p>}
    </div>
    {canEdit && <details className="editor-cleanup editor-cleanup-collapsed">
      <summary>Quick cleanup{cleanup.length > 0 ? ` · ${cleanup.length} suggestions` : ''}</summary>
      <div className="editor-cleanup-content">
        {cleanup.length ? <>
          <p>Review each suggested cut before applying it.</p>
          <div className="editor-cleanup-list">{cleanup.map(item => <label key={key(item)}><input type="checkbox" checked={selected.includes(key(item))} onChange={event => setSelected(value => event.target.checked ? [...value, key(item)] : value.filter(id => id !== key(item)))} /><span><b>{item.kind === 'pause' ? 'Quiet pause' : `Filler · ${item.label}`}</b><small>{(item.start_seconds - clip.start_seconds).toFixed(1)}s · {(item.end_seconds - item.start_seconds).toFixed(1)}s</small></span></label>)}</div>
          <button className="editor-cleanup-apply" disabled={!chosen.length} onClick={() => { onApplyCleanup(chosen); setSelected([]); }}>Remove {chosen.length ? `${chosen.length} selected · save ${saved.toFixed(1)}s` : 'selected moments'}</button>
          <small>You can undo this from the timeline.</small>
        </> : <p>{clip.words?.length ? 'No safe filler or quiet pause suggestions in this edit.' : 'Timed transcript needed for cleanup.'}</p>}
      </div>
    </details>}
  </aside>;
}
