"use client";
import { useState } from 'react';
import type { SavedClip } from '@/lib/clip-ui';
import { outputSpansForSourceCue, type SourceSegment } from '@/lib/editor-timeline';
export default function EditorTranscript({ clip, segments, time, onSeek }: {
    clip: SavedClip;
    segments: SourceSegment[];
    time: number;
    onSeek: (time: number) => void;
}) {
    const [query, setQuery] = useState('');
    const lines = [];
    for (let i = 0; i < (clip.words?.length ?? 0); i += 8) {
        const words = clip.words!.slice(i, i + 8);
        lines.push({ text: words.map(w => w.text).join(' '), start_ms: words[0].start, end_ms: words[words.length - 1].end });
    }
    return <aside className="editor-transcript"><h2>Transcript</h2><input aria-label="Search transcript" placeholder="Search transcript…" value={query} onChange={e => setQuery(e.target.value)}/><div className="editor-transcript-lines">{lines.filter(l => l.text.toLowerCase().includes(query.toLowerCase())).map((l, i) => { const spans = outputSpansForSourceCue(segments, l); const active = spans.some(s => time * 1000 >= s.start_ms && time * 1000 < s.end_ms); return <button key={i} disabled={!spans.length} aria-current={active ? 'true' : undefined} onClick={() => onSeek(spans[0].start_ms / 1000)}><time>{((l.start_ms / 1000) - clip.start_seconds).toFixed(0)}s</time><span>{l.text}</span></button>; })}{!lines.length && <p>No timed transcript was saved for this clip. Video and hook editing are available.</p>}{!!lines.length && !lines.some(l => l.text.toLowerCase().includes(query.toLowerCase())) && <p>No matching transcript lines.</p>}</div></aside>;
}
