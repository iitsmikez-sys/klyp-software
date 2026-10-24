"use client";
import { useState } from 'react';
import type { ClipEditDraftV2 } from '@/lib/clip-edit-draft';
import type { CaptionCue, SourceSegment } from '@/lib/editor-timeline';
import { HOOK_STYLES } from '@/lib/captions';
import { CAPTION_FONTS } from '@/lib/clip-edit-draft';
import CaptionTemplatePicker from './CaptionTemplatePicker';
import EditorFrameControls from './EditorFrameControls';
import type { VerticalLayoutV1 } from '@/lib/vertical-layout';
function Timing({ start, end, sourceStart, sourceEnd, onApply }: {
    sourceStart: number;
    sourceEnd: number;
    start: number;
    end: number;
    onApply: (start: number, end: number) => void;
}) {
    const [a, setA] = useState(String(start)), [b, setB] = useState(String(end));
    const [error, setError] = useState<string | null>(null);
    const apply = () => {
        const start = Number(a), end = Number(b);
        if (!a.trim() || !b.trim() || !Number.isFinite(start) || !Number.isFinite(end) || start < sourceStart || end > sourceEnd || end - start < 0.1 - 1e-9) {
            setError('Timing must stay within the original clip and last at least 0.1 seconds.');
            return;
        }
        setError(null);
        onApply(start, end);
    };
    return <><div className="editor-times"><label>Start<input aria-label="Selected start seconds" type="number" step="0.1" value={a} onChange={e => setA(e.target.value)}/></label><label>End<input aria-label="Selected end seconds" type="number" step="0.1" value={b} onChange={e => setB(e.target.value)}/></label></div><button onClick={apply}>Apply timing</button>{error && <p role="alert">{error}</p>}</>;
}
export default function EditorInspector({ draft, segment, cue, hooks, sourceStart, sourceEnd, onChange, onTrim, onCue, disabled, clipId, video, layout }: {
    draft: Omit<ClipEditDraftV2, "version"> & { version: 2 | 3 };
    sourceStart: number;
    sourceEnd: number;
    segment?: SourceSegment;
    cue?: CaptionCue;
    hooks: string[];
    onChange: (change: Partial<Omit<ClipEditDraftV2, "version">>) => void;
    onTrim: (id: string, start: number, end: number) => void;
    onCue: (cue: CaptionCue) => void;
    disabled: boolean;
    clipId: string;
    video: HTMLVideoElement | null;
    layout: VerticalLayoutV1 | null;
}) {
    const [tab, setTab] = useState<'edit' | 'style'>('edit');
    return <aside className="editor-inspector"><div className="editor-tabs"><button aria-pressed={tab === 'edit'} onClick={() => setTab('edit')}>Edit</button><button aria-pressed={tab === 'style'} onClick={() => setTab('style')}>Style</button></div><fieldset disabled={disabled}>
 {tab === 'edit' ? <>{cue && <section><h2>Caption</h2><label>Caption text<textarea aria-label="Caption text" value={cue.text} maxLength={1000} onChange={e => onCue({ ...cue, text: e.target.value })}/></label><p>Original source seconds</p><Timing sourceStart={sourceStart} sourceEnd={sourceEnd} key={`${cue.id}-${cue.start_ms}-${cue.end_ms}`} start={cue.start_ms / 1000} end={cue.end_ms / 1000} onApply={(a, b) => onCue({ ...cue, start_ms: a * 1000, end_ms: b * 1000 })}/></section>}<section><label>Hook text <span>{draft.hook.length}/80</span><textarea aria-label="Hook text" maxLength={80} value={draft.hook} onChange={e => onChange({ hook: e.target.value })}/></label><p>Shown for the first 3 seconds</p><div className="editor-suggestions" aria-label="Hook suggestions">{hooks.map(h => <button key={h} aria-pressed={draft.hook === h} onClick={() => onChange({ hook: h })}>{h}</button>)}{!hooks.length && <p>No suggestions saved.</p>}</div></section></> : null}
 <section><h3>Hook style</h3><div className="editor-options">{HOOK_STYLES.map(s => <button key={s} aria-pressed={draft.hook_style === s} onClick={() => onChange({ hook_style: s })}><strong>Aa</strong>{s.toLowerCase()}</button>)}</div></section>
 <CaptionTemplatePicker value={draft.caption_style} onChange={caption_style => onChange({ caption_style })}/>
 <section><h3>Font</h3><div className="caption-font-choices">{CAPTION_FONTS.map(font => <button key={font} type="button" aria-label={`${font} caption font`} aria-pressed={(draft.caption_font ?? 'sans') === font} onClick={() => onChange({ caption_font: font })} data-font={font}><strong>Ag</strong><span>{font === 'sans' ? 'Modern' : font === 'serif' ? 'Editorial' : 'Mono'}</span></button>)}</div></section>
 <section><h3>Caption color</h3><div className="editor-options">{(['white', 'yellow', 'green', 'pink'] as const).map(c => <button key={c} aria-label={`Caption color ${c}`} aria-pressed={draft.caption_color === c} onClick={() => onChange({ caption_color: c })}><i style={{ background: { white: '#fff', yellow: '#ffff00', green: '#00ff00', pink: '#ff69b4' }[c] }}/>{c}</button>)}</div></section><section><h3>Caption position</h3><div className="editor-options">{(['top', 'center', 'bottom'] as const).map(p => <button key={p} aria-pressed={draft.caption_position === p} onClick={() => onChange({ caption_position: p })}>{p}</button>)}</div></section>
 <section className="editor-audio-polish"><h3>Speech polish</h3><p>Reduce rumble and even out speech. Preview plays original audio; polish is applied on export.</p><div className="editor-options"><button type="button" aria-pressed={(draft.audio_polish ?? 'off') === 'off'} onClick={() => onChange({ audio_polish: 'off' })}>Original</button><button type="button" aria-pressed={draft.audio_polish === 'voice'} onClick={() => onChange({ audio_polish: 'voice' })}>Polish voice</button></div></section>
 {draft.aspect_ratio === '9:16' && <EditorFrameControls clipId={clipId} video={video} layout={layout} onChange={vertical_layout => onChange({ vertical_layout })}/>}
 {tab==='edit'&&segment && <details className="editor-trim-details"><summary>Trim selected clip</summary><section><p>Original source seconds</p><Timing sourceStart={sourceStart} sourceEnd={sourceEnd} key={`${segment.id}-${segment.start_seconds}-${segment.end_seconds}`} start={segment.start_seconds} end={segment.end_seconds} onApply={(a, b) => onTrim(segment.id, a, b)}/></section></details>}
 </fieldset></aside>;
}
