"use client";
import { useState } from 'react';
import type { SavedClip } from '@/lib/clip-ui';
import { outputSpansForSourceCue, type SourceSegment } from '@/lib/editor-timeline';
import type { CleanupCandidate } from '@/lib/transcript-edits';
export default function EditorTranscript({ clip, segments, time, onSeek, cleanup, onApplyCleanup, canEdit }: {
    clip: SavedClip;
    segments: SourceSegment[];
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
    const lines = [];
    for (let i = 0; i < (clip.words?.length ?? 0); i += 8) {
        const words = clip.words!.slice(i, i + 8);
        lines.push({ text: words.map(w => w.text).join(' '), start_ms: words[0].start, end_ms: words[words.length - 1].end });
    }
    return <aside className="editor-transcript"><div className="editor-panel-heading"><h2>Transcript</h2><span>Click a line to seek</span></div>{canEdit && <section className="editor-cleanup" aria-label="Quick cleanup"><div className="editor-cleanup-heading"><div><strong>Quick cleanup</strong><small>Review each suggested cut</small></div><span>{cleanup.length}</span></div>{cleanup.length ? <><div className="editor-cleanup-list">{cleanup.map(item => <label key={key(item)}><input type="checkbox" checked={selected.includes(key(item))} onChange={event => setSelected(value => event.target.checked ? [...value, key(item)] : value.filter(id => id !== key(item)))}/><span><b>{item.kind === 'pause' ? 'Quiet pause' : `Filler · ${item.label}`}</b><small>{(item.start_seconds - clip.start_seconds).toFixed(1)}s · {(item.end_seconds - item.start_seconds).toFixed(1)}s</small></span></label>)}</div><button className="editor-cleanup-apply" disabled={!chosen.length} onClick={() => { onApplyCleanup(chosen); setSelected([]); }}>Remove {chosen.length ? `${chosen.length} selected · save ${saved.toFixed(1)}s` : 'selected moments'}</button><small>You can undo this from the timeline.</small></> : <p>{clip.words?.length ? 'No safe filler or quiet pause suggestions in this edit.' : 'Timed transcript needed for cleanup.'}</p>}</section>}<input aria-label="Search transcript" placeholder="Search transcript…" value={query} onChange={e => setQuery(e.target.value)}/><div className="editor-transcript-lines">{lines.filter(l => l.text.toLowerCase().includes(query.toLowerCase())).map((l, i) => { const spans = outputSpansForSourceCue(segments, l); const active = spans.some(s => time * 1000 >= s.start_ms && time * 1000 < s.end_ms); return <button key={i} disabled={!spans.length} aria-current={active ? 'true' : undefined} onClick={() => onSeek(spans[0].start_ms / 1000)}><time>{Math.floor(Math.max(0,l.start_ms/1000-clip.start_seconds)/60).toString().padStart(2,'0')}:{Math.floor(Math.max(0,l.start_ms/1000-clip.start_seconds)%60).toString().padStart(2,'0')}</time><span>{l.text}</span></button>; })}{!lines.length && <p>No timed transcript was saved for this clip. Video and hook editing are available.</p>}{!!lines.length && !lines.some(l => l.text.toLowerCase().includes(query.toLowerCase())) && <p>No matching transcript lines.</p>}</div></aside>;
}
