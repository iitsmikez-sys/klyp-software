"use client";
import { useEffect, useState } from 'react';
import type { ClipEditDraftV3 } from '@/lib/clip-edit-draft';
import type { CaptionCue, SourceSegment } from '@/lib/editor-timeline';
import { HOOK_STYLES } from '@/lib/captions';
import { CAPTION_FONTS } from '@/lib/clip-edit-draft';
import CaptionTemplatePicker from './CaptionTemplatePicker';
import EditorFrameControls from './EditorFrameControls';
import EditorFocusControls from './EditorFocusControls';
import EditorIcon from './EditorIcon';
import type { VerticalLayoutV1 } from '@/lib/vertical-layout';

type Tool = 'transcript' | 'media' | 'captions' | 'style' | 'layout' | 'audio';
type InspectorTab = 'captions' | 'hook' | 'layout' | 'audio';
const tabForTool = (tool: Tool): InspectorTab => tool === 'style' ? 'hook' : tool === 'layout' || tool === 'audio' ? tool : 'captions';
const tabIcons = { captions: 'captions', hook: 'hook', layout: 'layout' } as const;

function Timing({ start, end, sourceStart, sourceEnd, onApply }: {
    sourceStart: number; sourceEnd: number; start: number; end: number;
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
        setError(null); onApply(start, end);
    };
    return <><div className="editor-times"><label>Start<input aria-label="Selected start seconds" type="number" step="0.1" value={a} onChange={e => setA(e.target.value)}/></label><label>End<input aria-label="Selected end seconds" type="number" step="0.1" value={b} onChange={e => setB(e.target.value)}/></label></div><button onClick={apply}>Apply timing</button>{error && <p role="alert">{error}</p>}</>;
}

export default function EditorInspector({ tool, onToolChange, draft, segment, cue, hooks, sourceStart, sourceEnd, onChange, onTrim, onCue, onAddCaptions, disabled, clipId, video, layout, outputTime, peaks, onSeek }: {
    tool: Tool; draft: ClipEditDraftV3; sourceStart: number; sourceEnd: number;
    onToolChange?: (tool: 'captions' | 'style' | 'layout' | 'audio') => void;
    segment?: SourceSegment; cue?: CaptionCue; hooks: string[];
    onChange: (change: Partial<Omit<ClipEditDraftV3, "version">>) => void;
    onTrim: (id: string, start: number, end: number) => void;
    onCue: (cue: CaptionCue) => void; onAddCaptions: () => void;
    disabled: boolean; clipId: string; video: HTMLVideoElement | null;
    layout: VerticalLayoutV1 | null; outputTime: number; peaks: number[] | null;
    onSeek: (seconds: number) => void;
}) {
    const [tab, setTab] = useState<InspectorTab>(tabForTool(tool));
    const [showHooks, setShowHooks] = useState(false);
    useEffect(() => setTab(tabForTool(tool)), [tool]);
    const chooseTab = (next: InspectorTab) => { setTab(next); onToolChange?.(next === 'hook' ? 'style' : next); };
    const previewHook = () => { if (outputTime >= 3) onSeek(0); };
    const hasCaptions = draft.caption_cues === null ? !!draft.words?.length : !!draft.caption_cues?.length;
    return <aside className="editor-inspector" aria-label={`${tab} inspector`}>
        <nav className="editor-inspector-tabs" aria-label="Inspector tools">{(['captions', 'hook', 'layout'] as const).map(next => <button key={next} type="button" aria-pressed={tab === next} onClick={() => chooseTab(next)}><EditorIcon name={tabIcons[next]}/>{next[0].toUpperCase()+next.slice(1)}</button>)}</nav>
        <fieldset disabled={disabled}>
        {tab === 'captions' && <>
            <section className="editor-inspector-section"><div className="editor-inspector-section-heading"><h3>Captions</h3><span>{hasCaptions ? 'Captions on' : 'No captions yet'}</span></div>
                {!hasCaptions && (draft.words?.length ? <><p className="editor-caption-notice">Captions are optional. Add them from the saved transcript when you are ready.</p><button type="button" className="editor-generate-captions" onClick={onAddCaptions}>Add captions</button></> : <p>Timed transcript is unavailable, so captions cannot be generated for this clip.</p>)}
            </section>
            {cue && <section className="editor-inspector-section"><h3>Selected caption</h3><label>Caption text<textarea aria-label="Caption text" value={cue.text} maxLength={1000} onChange={e => onCue({ ...cue, text: e.target.value })}/></label><p>Original source seconds</p><Timing sourceStart={sourceStart} sourceEnd={sourceEnd} key={`${cue.id}-${cue.start_ms}-${cue.end_ms}`} start={cue.start_ms / 1000} end={cue.end_ms / 1000} onApply={(a, b) => onCue({ ...cue, start_ms: a * 1000, end_ms: b * 1000 })}/></section>}
            <CaptionTemplatePicker value={draft.caption_style} onChange={caption_style => onChange({ caption_style })}/>
            <details className="editor-fine-tune"><summary>Fine-tune captions</summary>
                <section><h3>Font</h3><div className="caption-font-choices">{CAPTION_FONTS.map(font => <button key={font} type="button" aria-label={`${font} caption font`} aria-pressed={(draft.caption_font ?? 'sans') === font} onClick={() => onChange({ caption_font: font })} data-font={font}><strong>Ag</strong><span>{font === 'sans' ? 'Modern' : font === 'serif' ? 'Editorial' : 'Mono'}</span></button>)}</div></section>
                {draft.caption_style === 'COMIC' || draft.caption_style === 'KEYWORD' ? <p className="editor-fixed-palette">This template uses its own yellow or green palette.</p> : <section><h3>Caption color</h3><div className="editor-options">{(['white', 'yellow', 'green', 'pink'] as const).map(c => <button key={c} type="button" aria-label={`Caption color ${c}`} aria-pressed={draft.caption_color === c} onClick={() => onChange({ caption_color: c })}><i style={{ background: { white: '#fff', yellow: '#ffff00', green: '#00ff00', pink: '#ff69b4' }[c] }}/>{c}</button>)}</div></section>}
                <section><h3>Position</h3><div className="editor-options editor-position-options">{(['top', 'center', 'bottom'] as const).map(position => <button key={position} type="button" aria-label={`${position[0].toUpperCase()+position.slice(1)} caption position`} aria-pressed={!draft.caption_placement && draft.caption_position === position} onClick={() => onChange({ caption_position: position, caption_placement: undefined })}>{position[0].toUpperCase()+position.slice(1)}</button>)}</div><p>Drag captions on the video to place them anywhere.{draft.caption_placement ? ' Custom position is active.' : ''}</p></section>
            </details>
        </>}
        {tab === 'hook' && <>
            <section className="editor-inspector-section"><h3>Hook</h3><label>Hook text <span>{draft.hook.length}/80</span><textarea aria-label="Hook text" maxLength={80} value={draft.hook} onFocus={previewHook} onChange={e => { onChange({ hook: e.target.value }); previewHook(); }}/></label><p>Optional text shown for the first 3 seconds.</p><button type="button" className="editor-hook-disclosure" aria-expanded={showHooks} onClick={() => setShowHooks(value => !value)}>{showHooks ? 'Hide saved hook suggestions' : 'Show saved hook suggestions'} <span>{hooks.length}</span></button>{showHooks && <div className="editor-suggestions" aria-label="Saved hook suggestions">{hooks.map(h => <button key={h} type="button" aria-pressed={draft.hook === h} onClick={() => { onChange({ hook: h }); previewHook(); }}>{h}</button>)}{!hooks.length && <p>No hook suggestions were saved for this clip.</p>}</div>}</section>
            <section><h3>Hook style</h3><div className="editor-options editor-hook-style-options">{HOOK_STYLES.map(s => <button key={s} type="button" data-hook-style={s.toLowerCase()} aria-label={`${s === 'WHITE_BOX' ? 'White box' : s.toLowerCase()} hook style`} aria-pressed={draft.hook_style === s} onClick={() => onChange({ hook_style: s })}><strong>Aa</strong>{s === 'WHITE_BOX' ? 'White box' : s.toLowerCase()}</button>)}</div></section>
        </>}
        {tab === 'layout' && <><h2 className="editor-inspector-title">Layout</h2>{draft.aspect_ratio === '9:16' ? <><EditorFrameControls clipId={clipId} video={video} layout={layout} onChange={vertical_layout => onChange({ vertical_layout })}/><EditorFocusControls layout={layout} events={draft.focus_events ?? []} segments={draft.segments} words={draft.words ?? []} peaks={peaks} outputTime={outputTime} clipStart={sourceStart} clipEnd={sourceEnd} onChange={focus_events=>onChange({focus_events})} onSeek={onSeek}/></> : <p>Facecam and gameplay layouts are available in 9:16. Choose 9:16 below the preview to adjust them.</p>}{segment && <details className="editor-trim-details"><summary>Trim selected clip</summary><section><p>Original source seconds</p><Timing sourceStart={sourceStart} sourceEnd={sourceEnd} key={`${segment.id}-${segment.start_seconds}-${segment.end_seconds}`} start={segment.start_seconds} end={segment.end_seconds} onApply={(a, b) => onTrim(segment.id, a, b)}/></section></details>}</>}
        {tab === 'audio' && <section className="editor-audio-polish"><h3>Speech polish</h3><p>Reduce rumble and even out speech. Preview plays original audio; polish is applied on export.</p><div className="editor-options"><button type="button" aria-pressed={(draft.audio_polish ?? 'off') === 'off'} onClick={() => onChange({ audio_polish: 'off' })}>Original</button><button type="button" aria-pressed={draft.audio_polish === 'voice'} onClick={() => onChange({ audio_polish: 'voice' })}>Polish voice</button></div></section>}
        </fieldset>
    </aside>;
}
