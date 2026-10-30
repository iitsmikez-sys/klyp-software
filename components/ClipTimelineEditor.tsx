"use client";
import {timelineExportPayload} from '@/lib/editor-compatibility';
import {canUseExportFormat} from '@/lib/clips';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useUnsavedNavigationGuard } from './NavigationGuardProvider';
import { useRouter } from 'next/navigation';
import type { SavedClip } from '@/lib/clip-ui';
import { freshTimelineDraft, readClipEditDraft, upgradeClipEditDraft, validateClipEditDraft, type ClipEditDraftV3 } from '@/lib/clip-edit-draft';
import { buildCaptionCues } from '@/lib/captions';
import { resolveEditorCues } from '@/lib/editor-captions';
import { cutawayAtOutputTime, resolveCutawaySpans, resolveInsertSpans, composedAtOutputTime, composedDuration, composedOutputForSourceOnlyTime, sourceOnlyOutputForSourceSeconds, splitSegment, deleteSegment, type CaptionCue, type SourceSegment } from '@/lib/editor-timeline';
import { apply, reset, undo, redo } from '@/lib/editor-history';
import { saveTransition, needsNavigationGuard, reconcileSavedDraft, isEditorShortcutTarget, trimSelected, type SaveState, type Selection } from '@/lib/editor-session';
import { processingFetch } from '@/lib/processing-api';
import { getStoredHandle } from '@/lib/streamer-handle';
import { readLayoutExportWarning } from '@/lib/layout-export-warning';
import type { VerticalLayoutV1 } from '@/lib/vertical-layout';
import { useSparks } from './SparksProvider';
import ProGateModal from './ProGateModal';
import Logo from './Logo';
import EditorIcon from './EditorIcon';
import EditorMediaLibrary from './EditorMediaLibrary';
import EditorCutawayPreview, {type CutawayPicture} from './EditorCutawayPreview';
import EditorInsertedPreview from './EditorInsertedPreview';
import EditorOverlayGesture from './EditorOverlayGesture';
import EditorCutawayInspector from './EditorCutawayInspector';
import {createOverlayAtPlayhead, createTimelineInsert, mediaResponse, uploadEditorFile, type UploadPhase} from '@/lib/editor-media-client';
import type {EditorAsset} from '@/lib/editor-assets';
import {createClient} from '@/lib/supabase/client';
import EditorMedia, { type EditorMediaData } from './EditorMedia';
import EditorTimeline from './EditorTimeline';
import EditorTranscript from './EditorTranscript';
import { applyTranscriptCleanup, suggestTranscriptCleanup, type CleanupCandidate } from '@/lib/transcript-edits';
import { effectiveVerticalLayout } from '@/lib/vertical-layout-auth';
import { resolveFocusSpans } from '@/lib/editor-focus';
import EditorInspector from './EditorInspector';
import VerticalLayoutPreview from './VerticalLayoutPreview';
import EditorForegroundGesture from './EditorForegroundGesture';
import EditorTextPlacementOverlay from './EditorTextPlacementOverlay';
import './clip-timeline-editor.css';
import EditorFrameCanvas from './EditorFrameCanvas';
export default function ClipTimelineEditor({ clip, compatibilityNotice }: {
    clip: SavedClip;
    compatibilityNotice?: React.ReactNode;
}) {
    const initial = useRef(readClipEditDraft(clip));
    const [history, setHistory] = useState(() => reset(clip.edit_draft ? upgradeClipEditDraft(clip, initial.current.draft) : freshTimelineDraft(clip)));
    const draft = history.present;
    const [save, setSave] = useState<SaveState>(() => ({ confirmed: JSON.stringify(draft), pending: null, error: null }));
    const [selection, setSelection] = useState<Selection>({ type: 'video', id: draft.segments[0].id });
    const [time, setTime] = useState(0), [playing, setPlaying] = useState(false), [video, setVideo] = useState<HTMLVideoElement | null>(null), [media, setMedia] = useState<EditorMediaData>({ thumbnails: [], peaks: null, loading: true });
    const [seekRequest, setSeekRequest] = useState({ seconds: 0, id: 0 });
    const seek = (seconds: number) => { setTime(seconds); setSeekRequest(current => ({ seconds, id: current.id + 1 })); };
    const [,setVideoMetadataVersion]=useState(0);
    useEffect(()=>{
      if(!video)return;
      const refresh=()=>setVideoMetadataVersion(version=>version+1);
      video.addEventListener('loadedmetadata',refresh);
      if(video.videoWidth&&video.videoHeight)refresh();
      return()=>video.removeEventListener('loadedmetadata',refresh);
    },[video]);
    const [hasSaved, setHasSaved] = useState(!!clip.edit_draft);
    const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null), [exporting, setExporting] = useState(false), [gate, setGate] = useState(false), [layout, setLayout] = useState<VerticalLayoutV1 | null>(null);
    const [foregroundPreview,setForegroundPreview]=useState<VerticalLayoutV1|null>(null);
    const [textPreview,setTextPreview]=useState<Pick<ClipEditDraftV3,'hook_placement'|'caption_placement'>|null>(null);
    const router = useRouter(), { tier } = useSparks();
    const pro = tier === 'pro';
    const [leftTab,setLeftTab]=useState<'transcript'|'media'>('transcript');
    const [activeTool,setActiveTool]=useState<'transcript'|'media'|'captions'|'style'|'layout'|'audio'>('transcript');
    const hasInitialTranscript = useRef(Boolean((draft.words ?? clip.words)?.length));
    const [leftCollapsed,setLeftCollapsed]=useState(() => !hasInitialTranscript.current),[leftWidth,setLeftWidth]=useState(300);
    const leftResize=useRef<{x:number;width:number}|null>(null);
    const [assets,setAssets]=useState<EditorAsset[]>([]),[assetLoading,setAssetLoading]=useState(false),[assetError,setAssetError]=useState<string|null>(null),[upload,setUpload]=useState<UploadPhase|null>(null),[assetAttempt,setAssetAttempt]=useState(0);
    const [volume,setVolume]=useState(1),[muted,setMuted]=useState(false);
    useEffect(()=>{const narrow=window.matchMedia('(max-width: 1200px)');const sync=()=>setLeftCollapsed(narrow.matches || !hasInitialTranscript.current);sync();narrow.addEventListener('change',sync);return()=>narrow.removeEventListener('change',sync);},[]);
    useEffect(()=>{if(video){video.volume=volume;video.muted=muted;}},[video,volume,muted]);
    const formatTime=(seconds:number)=>Math.floor(seconds/60).toString().padStart(2,'0')+':'+Math.floor(seconds%60).toString().padStart(2,'0');
    const [picture,setPicture]=useState<CutawayPicture|null>(null);
    const [insertPicture,setInsertPicture]=useState<CutawayPicture|null>(null);
    const cutawaySpans=resolveCutawaySpans(draft), activeCutaway=cutawayAtOutputTime(cutawaySpans,time);
    const insertSpans=resolveInsertSpans(draft),activeInsert=insertSpans.find(span=>time*1000>=span.start_ms&&time*1000<span.end_ms)??null;
    const selectedCutaway=selection?.type==='cutaway'?draft.cutaways.find(c=>c.id===selection.id):undefined;
    const selectedInsert=selection?.type==='insert'?draft.inserts?.find(item=>item.id===selection.id):undefined;
    const onPicture=useCallback((next:CutawayPicture|null)=>setPicture(next),[]);
    useEffect(()=>{
        const controller=new AbortController();let live=true;setAssetLoading(true);setAssetError(null);
        fetch('/api/clips/'+clip.id+'/media',{signal:controller.signal}).then(r=>mediaResponse<{assets:EditorAsset[]}>(r)).then(data=>{if(live)setAssets(current=>[...data.assets.filter(a=>a.status==='verified'&&!current.some(existing=>existing.id===a.id)),...current]);}).catch(e=>{if(live)setAssetError(e.message);}).finally(()=>{if(live)setAssetLoading(false);});
        return()=>{live=false;controller.abort();};
    },[clip.id,pro,assetAttempt]);
    const importFile=async(file:File,kind:'photo'|'video')=>{
        if(upload)return;setAssetError(null);
        try{const asset=await uploadEditorFile(clip.id,file,kind,setUpload,{request:fetch,finalize:processingFetch,upload:async(path,token,file,mime)=>{const {error}=await createClient().storage.from('editor-media').uploadToSignedUrl(path,token,file,{contentType:mime});if(error)throw error;}});setAssets(previous=>[...previous.filter(a=>a.id!==asset.id),asset]);setLeftTab('media');setActiveTool('media');setLeftCollapsed(false);}
        catch(e){setAssetError((e as Error).message);}finally{setUpload(null);}
    };
    const insertAsset=(asset:EditorAsset,at=time)=>attempt(()=>{const cutaway=createOverlayAtPlayhead(draft,asset,at,crypto.randomUUID());commit({...draft,cutaways:[...draft.cutaways,cutaway]});setSelection({type:'cutaway',id:cutaway.id});});
    const insertAfter=(asset:EditorAsset,id?:string)=>attempt(()=>{const segmentId=id??(selection?.type==='video'?selection.id:null);if(!segmentId)throw new Error('Select a split video section first.');if(draft.segments.at(-1)?.id===segmentId)throw new Error('Split the video first, then insert between its sections.');const item=createTimelineInsert(draft,asset,segmentId,crypto.randomUUID());commit({...draft,inserts:[...(draft.inserts??[]),item]});setSelection({type:'insert',id:item.id});});
    const dropAsset=(asset:EditorAsset,target:{kind:'overlay';time:number}|{kind:'insert';afterSegmentId:string})=>{if(target.kind==='insert')insertAfter(asset,target.afterSegmentId);else insertAsset(asset,target.time);};
    const dirty = needsNavigationGuard(save, JSON.stringify(draft));
    const duration = composedDuration(draft);
    const cleanup = suggestTranscriptCleanup(draft.words ?? clip.words ?? [], clip.start_seconds, draft.segments, media.peaks, duration);
    const applyCleanup = (items: CleanupCandidate[]) => { const next = applyTranscriptCleanup(draft.segments, items); if(next !== draft.segments) { commit({...draft,segments:next,inserts:draft.inserts?.filter(item=>next.some(segment=>segment.id===item.after_segment_id)),start_seconds:next[0].start_seconds,end_seconds:next[next.length-1].end_seconds}); setSelection({type:'video',id:next[0].id}); seek(0); } };
    const cues = resolveEditorCues(draft, clip);
    const atSource=composedAtOutputTime(draft,time);
    const sourceOnlyTime=sourceOnlyOutputForSourceSeconds(draft.segments,atSource.kind==='source'?atSource.sourceSeconds:draft.segments.find(segment=>segment.id===atSource.span.after_segment_id)!.end_seconds);
    const shiftedThumbnails=media.thumbnails.map(item=>({...item,outputSeconds:composedOutputForSourceOnlyTime(draft,item.outputSeconds)}));
    // The default framing does not imply a gameplay focus edit. Only show the
    // focus track when the clip actually contains saved focus changes.
    const focusSpans = draft.focus_events?.length ? resolveFocusSpans(draft.focus_events, draft.segments,draft.inserts) : [];
    const clock = useRef(time);
    clock.current = time;
    const sourceCues = () => draft.caption_cues ?? buildCaptionCues(draft.words ?? clip.words ?? [], clip.start_seconds * 1000, clip.end_seconds * 1000, draft.caption_style === 'KLYP' || draft.caption_style === 'SPARK' ? 1 : 4).map((c, i) => ({ id: `auto-${i}`, start_ms: c.startMs + clip.start_seconds * 1000, end_ms: c.endMs + clip.start_seconds * 1000, text: c.text }));
    const addTranscriptCaptions = () => { const generated = buildCaptionCues(draft.words ?? clip.words ?? [], clip.start_seconds * 1000, clip.end_seconds * 1000, draft.caption_style === 'KLYP' || draft.caption_style === 'SPARK' ? 1 : 4).map((c,i) => ({ id: `auto-${i}`, start_ms: c.startMs + clip.start_seconds * 1000, end_ms: c.endMs + clip.start_seconds * 1000, text: c.text })); if (generated.length) commit({...draft, caption_cues:generated}); };
    const cue = selection?.type === 'caption' ? sourceCues().filter(c => selection.id === c.id || selection.id.startsWith(c.id + ':fragment:')).sort((a, b) => b.id.length - a.id.length)[0] : undefined;
    const commit = (next: ClipEditDraftV3) => { setHistory(h => apply(h, next)); setError(null); setNotice(null); };
    const segments = (s: SourceSegment[]) => commit({ ...draft, segments: s, inserts:draft.inserts?.filter(item=>s.some(segment=>segment.id===item.after_segment_id)), focus_events: draft.focus_events?.filter(event => s.some(segment => event.source_ms >= segment.start_seconds * 1000 && event.source_ms < segment.end_seconds * 1000)), start_seconds: s[0].start_seconds, end_seconds: s[s.length - 1].end_seconds });
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
    else if (selection?.type==='cutaway') {
        commit({...draft,cutaways:draft.cutaways.filter(c=>c.id!==selection.id)});setSelection(null);
    }
    else if(selection?.type==='insert') {commit({...draft,inserts:(draft.inserts??[]).filter(item=>item.id!==selection.id)});setSelection(null);}
    else if (cue) {
        commit({ ...draft, caption_cues: sourceCues().filter(c => c.id !== cue.id) });
        setSelection(null);
    } });
    const split = () => attempt(() => { const position=composedAtOutputTime(draft,time);if(position.kind==='insert')throw new Error('Move the playhead to source video to split.');const at=position.sourceSeconds; if (selection?.type === 'video') {
        const next=splitSegment(draft.segments,selection.id,at),child=next.find(segment=>segment.id!==selection.id&&Math.abs(segment.start_seconds-at)<.00001);
        commit({...draft,segments:next,inserts:draft.inserts?.map(item=>item.after_segment_id===selection.id&&child?{...item,after_segment_id:child.id}:item),start_seconds:next[0].start_seconds,end_seconds:next[next.length-1].end_seconds});
    }
    else if (cue) {
        if (at * 1000 - cue.start_ms < 100 || cue.end_ms - at * 1000 < 100)
            throw new Error('Place the playhead inside the selected caption.');
        commit({ ...draft, caption_cues: sourceCues().flatMap(c => c.id === cue.id ? [{ ...c, end_ms: at * 1000 }, { ...c, id: crypto.randomUUID(), start_ms: at * 1000 }] : c).sort((a, b) => a.start_ms - b.start_ms) });
    } });
    useEffect(() => { fetch('/api/vertical-layout').then(r => r.json()).then(d => setLayout(d.layout ?? null)).catch(() => { }); }, []);
    useEffect(() => { if (time > duration)
        seek(duration); }, [duration, time]);
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
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
                event.preventDefault();
                setHistory(value => event.shiftKey ? redo(value) : undo(value));
            }
            if ((event.key === 'Delete' || event.key === 'Backspace')) {
                event.preventDefault();
                remove();
            }
        };
        window.addEventListener('keydown', key);
        return () => window.removeEventListener('keydown', key);
    });
    const persist = async () => { try {
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
    const exportClip = async () => { setExporting(true); setError(null); const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 600000); try {
        const checked = validateClipEditDraft(draft, clip);
        const res = await processingFetch('/api/clip', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ ...timelineExportPayload(clip, checked as ClipEditDraftV3, pro), handle: getStoredHandle() }) });
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
    const previous = () => seek([...cues].reverse().find(c => c.start_ms / 1000 < time - .05)?.start_ms! / 1000 || 0);
    const next = () => seek(cues.find(c => c.start_ms / 1000 > time + .05)?.start_ms! / 1000 || duration);
    const leave = () => { if (!dirty || window.confirm('Leave without saving your clip edits?'))
        router.push('/dashboard/clips'); };
    return <div className="clip-editor"><header className="editor-header"><button className="editor-logo" onClick={leave} aria-label="Back to clips"><Logo size="md" /></button><input aria-label="Clip title" value={draft.title} maxLength={120} onChange={e => commit({ ...draft, title: e.target.value })}/><span role="status">{save.pending ? 'Saving…' : save.error ? 'Save failed' : dirty ? 'Unsaved changes' : hasSaved ? 'Edits saved' : 'Original clip'}</span>{compatibilityNotice}<button disabled={!dirty || !!save.pending || initial.current.unsupportedVersion} onClick={persist}>Save</button><button className="editor-export" disabled={exporting} onClick={exportClip}><EditorIcon name="export"/>{exporting ? 'Exporting…' : 'Export clip'}</button></header>
 {initial.current.unsupportedVersion && <p role="alert" className="editor-alert">This saved draft is invalid or from a newer editor. Showing the original clip; saving is disabled to preserve your draft.</p>}{(error || save.error || notice) && <p role={error || save.error ? 'alert' : 'status'} className="editor-alert">{error || save.error || notice}</p>}
 <div className="editor-workspace" data-left-collapsed={leftCollapsed} style={{'--editor-left-width':leftWidth+'px'} as CSSProperties}>
 <nav className="editor-rail" aria-label="Editor panels">
  <button type="button" aria-label="Transcript panel" aria-pressed={activeTool==='transcript'} onClick={()=>{setActiveTool('transcript');setLeftTab('transcript');setLeftCollapsed(false);}}><EditorIcon name="transcript"/>Transcript</button>
  <button type="button" aria-label="Media panel" aria-pressed={activeTool==='media'} onClick={()=>{setActiveTool('media');setLeftTab('media');setLeftCollapsed(false);}}><EditorIcon name="photo"/>Media</button>
  <button type="button" aria-label="Audio panel" aria-pressed={activeTool==='audio'} onClick={()=>setActiveTool('audio')}><EditorIcon name="audio"/>Audio</button>
  <button type="button" className="editor-rail-collapse" aria-label={leftCollapsed?`Expand ${leftTab}`:`Collapse ${leftTab}`} onClick={()=>setLeftCollapsed(value=>!value)}>{leftCollapsed?'›':'‹'}</button>
 </nav>
 <div className="editor-left-panel">{leftTab==='transcript'&&<EditorTranscript clip={clip} segments={draft.segments} inserts={draft.inserts} time={time} onSeek={seek} cleanup={cleanup} onApplyCleanup={applyCleanup} canEdit={true}/>}<EditorMediaLibrary compact={leftTab==='transcript'} assets={assets} loading={assetLoading} error={assetError} upload={upload} onFile={importFile} onInsert={insertAsset} onInsertAfter={asset=>insertAfter(asset)} canInsert={selection?.type==='video'&&draft.segments.at(-1)?.id!==selection.id} onDrop={dropAsset} onRetry={()=>setAssetAttempt(a=>a+1)} onGate={()=>setGate(true)} disabled={false}/>{leftTab==='media'&&draft.cutaways.length>0&&<section className="editor-cutaway-list" aria-label="All cutaways"><h3>On the timeline</h3>{draft.cutaways.map(c=><button key={c.id} type="button" onClick={()=>{setSelection({type:'cutaway',id:c.id});const span=cutawaySpans.find(s=>s.id===c.id);if(span)seek(span.start_ms/1000);}}>{assets.find(a=>a.id===c.asset_id)?.file_name||'Imported cutaway'}{!cutawaySpans.some(s=>s.id===c.id)&&' · footage removed'}</button>)}</section>}</div>
 <button type="button" className="editor-left-resize" aria-label="Resize transcript" title="Drag or use arrow keys to resize the left panel" onPointerDown={e=>{leftResize.current={x:e.clientX,width:leftWidth};e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{if(leftResize.current)setLeftWidth(Math.max(220,Math.min(440,leftResize.current.width+e.clientX-leftResize.current.x)));}} onPointerUp={e=>{leftResize.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}} onLostPointerCapture={()=>{leftResize.current=null;}} onKeyDown={e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();setLeftWidth(w=>Math.max(220,Math.min(440,w+(e.key==='ArrowRight'?16:-16))));}}}/><main className="editor-player"><div className="editor-source"><EditorMedia clip={clip} segments={draft.segments} inserts={draft.inserts} suppressTime={!!activeInsert} outputTime={time} seekRequest={seekRequest} playing={playing&&!activeInsert} onTimeChange={setTime} onPlayingChange={setPlaying} onVideo={setVideo} onMedia={setMedia}/></div><div className="editor-stage"><div className="editor-canvas" style={{ aspectRatio: draft.aspect_ratio === "Original" ? `${video?.videoWidth || 16}/${video?.videoHeight || 9}` : draft.aspect_ratio.replace(":", "/") }}><EditorCutawayPreview clipId={clip.id} active={activeCutaway} outputTime={time} playing={playing&&!activeInsert} sourceVideo={video} muted={muted} volume={volume} onPicture={onPicture}/><EditorInsertedPreview clipId={clip.id} active={activeInsert} time={time} playing={playing} muted={muted} volume={volume} onPicture={setInsertPicture} onTimeChange={setTime} onFinish={seek}/><EditorFrameCanvas video={video} layout={effectiveVerticalLayout(layout,draft.vertical_layout)} enabled={draft.aspect_ratio==='9:16' && !activeCutaway && (!!effectiveVerticalLayout(layout,draft.vertical_layout)?.facecam || !!effectiveVerticalLayout(layout,draft.vertical_layout)?.fit)} onCommit={vertical_layout=>commit({...draft,vertical_layout})}>{previewLayout => <VerticalLayoutPreview inserted={activeInsert} picture={activeInsert?insertPicture:picture} format={draft.aspect_ratio} video={video} layout={foregroundPreview ?? previewLayout} editor={{ draft: textPreview ? {...draft,...textPreview} : draft, clip, outputTime: () => clock.current }}/>}</EditorFrameCanvas>{activeCutaway?.placement==='overlay' && <EditorOverlayGesture overlay={draft.cutaways.find(c=>c.id===activeCutaway.id)!} onSelect={()=>setSelection({type:'cutaway',id:activeCutaway.id})} onCommit={next=>commit({...draft,cutaways:draft.cutaways.map(c=>c.id===next.id?next:c)})}/>} {draft.aspect_ratio==='9:16' && !activeCutaway && <EditorForegroundGesture video={video} layout={effectiveVerticalLayout(layout,draft.vertical_layout)} onPreview={setForegroundPreview} onCommit={vertical_layout=>commit({...draft,vertical_layout})}/>} {!activeCutaway && <EditorTextPlacementOverlay draft={textPreview ? {...draft,...textPreview} : draft} clip={clip} time={time} video={video} layout={effectiveVerticalLayout(layout,draft.vertical_layout)} onPreview={setTextPreview} onCommit={change=>commit({...draft,...change})}/>}</div></div><div className="editor-transport"><div className="editor-volume"><button aria-label={muted?'Unmute':'Mute'} onClick={()=>setMuted(m=>!m)}><EditorIcon name={muted?'muted':'volume'}/></button><input aria-label="Playback volume" type="range" min="0" max="1" step="0.05" value={volume} onChange={e=>setVolume(Number(e.target.value))}/></div><div className="editor-transport-center"><span className="editor-time">{formatTime(time)} <span>/ {formatTime(duration)}</span></span><div className="editor-playback"><button aria-label="Previous caption" onClick={previous}><EditorIcon name="previous"/></button><button aria-label={playing ? 'Pause' : 'Play'} onClick={() => setPlaying(p => !p)}><EditorIcon name={playing?'pause':'play'}/></button><button aria-label="Next caption" onClick={next}><EditorIcon name="next"/></button></div></div><select aria-label="Export aspect ratio" value={draft.aspect_ratio} onChange={e => { const aspect_ratio=e.target.value as ClipEditDraftV3["aspect_ratio"];if(!canUseExportFormat(aspect_ratio,pro)){setGate(true);return;}commit({...draft,aspect_ratio}); }}>{["9:16", "16:9", "1:1", "Original"].map(f => <option key={f} disabled={!canUseExportFormat(f as ClipEditDraftV3["aspect_ratio"],pro)}>{f}</option>)}</select></div></main>{selectedCutaway?<EditorCutawayInspector draft={draft} cutaway={selectedCutaway} asset={assets.find(a=>a.id===selectedCutaway.asset_id)} onChange={next=>commit({...draft,cutaways:draft.cutaways.map(c=>c.id===next.id?next:c)})} onRemove={remove} disabled={false}/>:selectedInsert?<aside className="editor-inspector editor-insert-inspector"><h2>Inserted media</h2><p>{assets.find(a=>a.id===selectedInsert.asset_id)?.file_name??'Imported media'}</p>{assets.find(a=>a.id===selectedInsert.asset_id)?.kind==='video'?<><label><input type="checkbox" checked={!selectedInsert.muted} onChange={e=>commit({...draft,inserts:(draft.inserts??[]).map(item=>item.id===selectedInsert.id?{...item,muted:!e.target.checked}:item)})}/> Play imported audio</label><p>Video audio plays by default unless muted here.</p></>:<p>Photos have no audio.</p>}<button type="button" onClick={remove}>Remove section</button></aside>:<EditorInspector tool={activeTool} onToolChange={setActiveTool} sourceStart={clip.start_seconds} sourceEnd={clip.end_seconds} draft={draft} segment={selection?.type === 'video' ? draft.segments.find(s => s.id === selection.id) : undefined} cue={cue} hooks={clip.hooks ?? []} onChange={c => commit({ ...draft, ...c })} onTrim={trim} onCue={editCue} onAddCaptions={addTranscriptCaptions} disabled={false} clipId={clip.id} video={video} layout={effectiveVerticalLayout(layout, draft.vertical_layout)} outputTime={sourceOnlyTime} peaks={draft.inserts?.length?null:media.peaks} onSeek={seconds=>seek(composedOutputForSourceOnlyTime(draft,seconds))}/>}</div>
 <div className="editor-tools"><button disabled={!selection || selection.type==='cutaway'} onClick={split}><EditorIcon name="split"/>Split</button><button disabled={!selection || (selection.type === 'video' && draft.segments.length === 1)} onClick={remove}><EditorIcon name="delete"/>Delete</button><button disabled={!history.past.length} onClick={() => setHistory(undo)}><EditorIcon name="undo"/>Undo</button><button disabled={!history.future.length} onClick={() => setHistory(redo)}><EditorIcon name="redo"/>Redo</button><span role="status">{!selection ? 'Select a video section or caption to edit.' : selection.type === 'cutaway' ? 'Select a video section or caption to split; Delete removes this cutaway.' : selection.type === 'video' && draft.segments.length === 1 ? 'Split the video before deleting a section.' : 'Drag mint trim handles to adjust the cut · Space to play · Arrow keys nudge trims'}</span></div><EditorTimeline focusSpans={focusSpans} cutaways={cutawaySpans} inserts={insertSpans} segments={draft.segments} captions={cues} hook={draft.hook} outputTime={time} thumbnails={shiftedThumbnails} peaks={draft.inserts?.length?null:media.peaks} mediaLoading={media.loading} sourceStart={clip.start_seconds} sourceEnd={clip.end_seconds} selection={selection} onSelect={value=>{setSelection(value);if(value?.type==='caption')setActiveTool('captions');if(value?.type==='cutaway')setActiveTool('media');}} onSeek={seek} onTrim={trim}/>{gate && <ProGateModal onClose={() => setGate(false)}/>}</div>;
}
