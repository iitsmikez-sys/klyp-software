"use client";
import { useEffect, useRef, useState } from 'react';
import { useUnsavedNavigationGuard } from './NavigationGuardProvider';
import { useRouter } from 'next/navigation';
import type { SavedClip } from '@/lib/clip-ui';
import { readClipEditDraft, upgradeClipEditDraft, validateClipEditDraft, toClipExportPayload, type ClipEditDraftV2 } from '@/lib/clip-edit-draft';
import { buildCaptionCues } from '@/lib/captions';
import { resolveEditorCues } from '@/lib/editor-captions';
import { outputDuration, sourceAtOutputTime, splitSegment, deleteSegment, type CaptionCue, type SourceSegment } from '@/lib/editor-timeline';
import { apply, reset, undo, redo } from '@/lib/editor-history';
import { saveTransition, needsNavigationGuard, reconcileSavedDraft, isEditorShortcutTarget, trimSelected, type SaveState, type Selection } from '@/lib/editor-session';
import { processingFetch } from '@/lib/processing-api';
import { getStoredHandle } from '@/lib/streamer-handle';
import { readLayoutExportWarning } from '@/lib/layout-export-warning';
import type { VerticalLayoutV1 } from '@/lib/vertical-layout';
import { useSparks } from './SparksProvider';
import ProGateModal from './ProGateModal';
import Logo from './Logo';
import EditorMedia, { type EditorMediaData } from './EditorMedia';
import EditorTimeline from './EditorTimeline';
import EditorTranscript from './EditorTranscript';
import { effectiveVerticalLayout } from '@/lib/vertical-layout-auth';
import EditorInspector from './EditorInspector';
import VerticalLayoutPreview from './VerticalLayoutPreview';
import './clip-timeline-editor.css';
export default function ClipTimelineEditor({ clip }: {
    clip: SavedClip;
}) {
    const initial = useRef(readClipEditDraft(clip));
    const [history, setHistory] = useState(() => reset(upgradeClipEditDraft(clip, initial.current.draft)));
    const draft = history.present;
    const [save, setSave] = useState<SaveState>(() => ({ confirmed: JSON.stringify(draft), pending: null, error: null }));
    const [selection, setSelection] = useState<Selection>({ type: 'video', id: draft.segments[0].id });
    const [time, setTime] = useState(0), [playing, setPlaying] = useState(false), [video, setVideo] = useState<HTMLVideoElement | null>(null), [media, setMedia] = useState<EditorMediaData>({ thumbnails: [], peaks: null, loading: true });
    const [hasSaved, setHasSaved] = useState(!!clip.edit_draft);
    const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null), [exporting, setExporting] = useState(false), [gate, setGate] = useState(false), [layout, setLayout] = useState<VerticalLayoutV1 | null>(null);
    const router = useRouter(), { tier } = useSparks();
    const pro = tier === 'pro';
    const dirty = needsNavigationGuard(save, JSON.stringify(draft));
    const duration = outputDuration(draft.segments);
    const cues = resolveEditorCues(draft, clip);
    const clock = useRef(time);
    clock.current = time;
    const sourceCues = () => draft.caption_cues ?? buildCaptionCues(draft.words ?? clip.words ?? [], clip.start_seconds * 1000, clip.end_seconds * 1000, draft.caption_style === 'KLYP' ? 1 : 4).map((c, i) => ({ id: `auto-${i}`, start_ms: c.startMs + clip.start_seconds * 1000, end_ms: c.endMs + clip.start_seconds * 1000, text: c.text }));
    const cue = selection?.type === 'caption' ? sourceCues().filter(c => selection.id === c.id || selection.id.startsWith(c.id + ':fragment:')).sort((a, b) => b.id.length - a.id.length)[0] : undefined;
    const commit = (next: ClipEditDraftV2) => { if (!pro) {
        setGate(true);
        return;
    } setHistory(h => apply(h, next)); setError(null); setNotice(null); };
    const segments = (s: SourceSegment[]) => commit({ ...draft, segments: s, start_seconds: s[0].start_seconds, end_seconds: s[s.length - 1].end_seconds });
    const attempt = (fn: () => void) => { try {
        fn();
    }
    catch (e) {
        setError((e as Error).message);
    } };
    const trim = (id: string, a: number, b: number) => attempt(() => segments(trimSelected(draft.segments, id, a, b, clip.start_seconds, clip.end_seconds)));
    const editCue = (next: CaptionCue) => commit({ ...draft, caption_cues: sourceCues().map(c => c.id === next.id ? next : c).sort((a, b) => a.start_ms - b.start_ms) });
    const remove = () => attempt(() => { if (selection?.type === 'video') {
        segments(deleteSegment(draft.segments, selection.id));
        setSelection(null);
    }
    else if (cue) {
        commit({ ...draft, caption_cues: sourceCues().filter(c => c.id !== cue.id) });
        setSelection(null);
    } });
    const split = () => attempt(() => { const at = sourceAtOutputTime(draft.segments, time); if (selection?.type === 'video')
        segments(splitSegment(draft.segments, selection.id, at));
    else if (cue) {
        if (at * 1000 - cue.start_ms < 100 || cue.end_ms - at * 1000 < 100)
            throw new Error('Place the playhead inside the selected caption.');
        commit({ ...draft, caption_cues: sourceCues().flatMap(c => c.id === cue.id ? [{ ...c, end_ms: at * 1000 }, { ...c, id: crypto.randomUUID(), start_ms: at * 1000 }] : c).sort((a, b) => a.start_ms - b.start_ms) });
    } });
    useEffect(() => { fetch('/api/vertical-layout').then(r => r.json()).then(d => setLayout(d.layout ?? null)).catch(() => { }); }, []);
    useEffect(() => { if (time > duration)
        setTime(duration); }, [duration, time]);
    useUnsavedNavigationGuard(dirty);
    useEffect(() => {
        const key = (event: KeyboardEvent) => {
            const element = event.target as HTMLElement;
            const target = element.closest('button,a,input,textarea,select,summary,[role],[contenteditable]') as HTMLElement | null;
            if (target && !isEditorShortcutTarget(target.tagName, target.getAttribute('role'), target.isContentEditable, event.code)) return;
            if (event.code === 'Space') {
                event.preventDefault();
                setPlaying(value => !value);
            }
            if (pro && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
                event.preventDefault();
                setHistory(value => event.shiftKey ? redo(value) : undo(value));
            }
            if (pro && (event.key === 'Delete' || event.key === 'Backspace')) {
                event.preventDefault();
                remove();
            }
        };
        window.addEventListener('keydown', key);
        return () => window.removeEventListener('keydown', key);
    });
    const persist = async () => { if (!pro) {
        setGate(true);
        return;
    } try {
        const submitted = draft;
        const checked = validateClipEditDraft(submitted, clip);
        setSave(s => saveTransition(s, { type: 'pending', snapshot: JSON.stringify(checked) }));
        const res = await fetch(`/api/clips/${clip.id}/edit-draft`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draft: checked }) });
        const data = await res.json();
        if (!res.ok)
            throw new Error(data.error ?? 'Save failed');
        const confirmed = upgradeClipEditDraft(clip, validateClipEditDraft(data.edit_draft, clip));
        setHistory(h => ({ ...h, present: reconcileSavedDraft(h.present, submitted, confirmed) }));
        setSave(s => ({ ...saveTransition(s, { type: 'success' }), confirmed: JSON.stringify(confirmed) }));
        setHasSaved(true);
    }
    catch (e) {
        setSave(s => saveTransition(s, { type: 'error', message: (e as Error).message }));
    } };
    const exportClip = async () => { if (!pro) {
        setGate(true);
        return;
    } setExporting(true); setError(null); const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 600000); try {
        const checked = validateClipEditDraft(draft, clip);
        const res = await processingFetch('/api/clip', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ ...toClipExportPayload(clip, checked), handle: getStoredHandle() }) });
        if (!res.ok)
            throw new Error((await res.json()).error ?? 'Export failed');
        setNotice(readLayoutExportWarning(res));
        const url = URL.createObjectURL(await res.blob());
        const a = document.createElement('a');
        a.href = url;
        a.download = (draft.title.replace(/[^a-z0-9_-]/gi, '_') || 'klyp_clip') + '.mp4';
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
    catch (e) {
        setError(controller.signal.aborted ? 'Export timed out. Your edits are still here.' : (e as Error).message);
    }
    finally {
        clearTimeout(timeout);
        setExporting(false);
    } };
    const previous = () => setTime([...cues].reverse().find(c => c.start_ms / 1000 < time - .05)?.start_ms! / 1000 || 0);
    const next = () => setTime(cues.find(c => c.start_ms / 1000 > time + .05)?.start_ms! / 1000 || duration);
    const leave = () => { if (!dirty || window.confirm('Leave without saving your clip edits?'))
        router.push('/dashboard/clips'); };
    return <div className="clip-editor"><header className="editor-header"><button className="editor-logo" onClick={leave} aria-label="Back to clips"><Logo size="md" /></button><input aria-label="Clip title" value={draft.title} maxLength={120} disabled={!pro} onChange={e => commit({ ...draft, title: e.target.value })}/><span role="status">{save.pending ? 'Saving…' : save.error ? 'Save failed' : dirty ? 'Unsaved changes' : hasSaved ? 'Saved to Klyp' : 'Original clip'}</span><button disabled={!dirty || !!save.pending || initial.current.unsupportedVersion} onClick={persist}>Save</button><button className="editor-export" disabled={exporting} onClick={exportClip}>{exporting ? 'Exporting…' : 'Export clip ↑'}</button></header>
 {initial.current.unsupportedVersion && <p role="alert" className="editor-alert">This saved draft is invalid or from a newer editor. Showing the original clip; saving is disabled to preserve your draft.</p>}{(error || save.error || notice) && <p role={error || save.error ? 'alert' : 'status'} className="editor-alert">{error || save.error || notice}</p>}{!pro && <p className="editor-alert">Preview your clip here. Editing, saving and exporting this timeline require Pro.</p>}
 <div className="editor-workspace"><EditorTranscript clip={clip} segments={draft.segments} time={time} onSeek={setTime}/><main className="editor-player"><div className="editor-source"><EditorMedia clip={clip} segments={draft.segments} outputTime={time} playing={playing} onTimeChange={setTime} onPlayingChange={setPlaying} onVideo={setVideo} onMedia={setMedia}/></div><div className="editor-canvas" style={{ aspectRatio: draft.aspect_ratio === "Original" ? `${video?.videoWidth || 16}/${video?.videoHeight || 9}` : draft.aspect_ratio.replace(":", "/") }}><VerticalLayoutPreview format={draft.aspect_ratio} video={video} layout={effectiveVerticalLayout(layout, draft.vertical_layout)} editor={{ draft, clip, outputTime: () => clock.current }}/></div><div className="editor-transport"><span>{time.toFixed(1)} / {duration.toFixed(1)}</span><button aria-label="Previous caption" onClick={previous}>⏮</button><button aria-label={playing ? 'Pause' : 'Play'} onClick={() => setPlaying(p => !p)}>{playing ? 'Ⅱ' : '▶'}</button><button aria-label="Next caption" onClick={next}>⏭</button><select aria-label="Export aspect ratio" value={draft.aspect_ratio} disabled={!pro} onChange={e => commit({ ...draft, aspect_ratio: e.target.value as ClipEditDraftV2["aspect_ratio"] })}>{["9:16", "16:9", "1:1", "Original"].map(f => <option key={f}>{f}</option>)}</select></div></main><EditorInspector sourceStart={clip.start_seconds} sourceEnd={clip.end_seconds} draft={draft} segment={selection?.type === 'video' ? draft.segments.find(s => s.id === selection.id) : undefined} cue={cue} hooks={clip.hooks ?? []} onChange={c => commit({ ...draft, ...c })} onTrim={trim} onCue={editCue} disabled={!pro}/></div>
 <div className="editor-tools"><button disabled={!pro || !selection} onClick={split}>✂ Split</button><button disabled={!pro || !selection || (selection.type === 'video' && draft.segments.length === 1)} onClick={remove}>⌫ Delete</button><button disabled={!pro || !history.past.length} onClick={() => setHistory(undo)}>↶ Undo</button><button disabled={!pro || !history.future.length} onClick={() => setHistory(redo)}>↷ Redo</button><span>Space to play · Select a clip or caption to edit</span></div><EditorTimeline segments={draft.segments} captions={cues} hook={draft.hook} outputTime={time} thumbnails={media.thumbnails} peaks={media.peaks} mediaLoading={media.loading} sourceStart={clip.start_seconds} sourceEnd={clip.end_seconds} selection={selection} onSelect={setSelection} onSeek={setTime} onTrim={trim}/>{gate && <ProGateModal onClose={() => setGate(false)}/>}</div>;
}
