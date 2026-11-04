"use client";
import { Fragment, useEffect, useRef, useState } from 'react';
import { outputDuration, type CaptionCue, type SourceSegment, type ResolvedCutawaySpan, type ResolvedInsertSpan } from '@/lib/editor-timeline';
import { timeToPixels, type EditorThumbnail } from '@/lib/editor-preview';
import { groupCaptionCues } from '@/lib/editor-caption-groups';
import type { FocusSpan } from '@/lib/editor-focus';
import { SNAP_PX, nearestSnap, timelineSnapPoints } from '@/lib/editor-timeline-snap';
export type TimelineSelection = {type:'video' | 'caption' | 'cutaway' | 'insert'; id:string} | null;
export type EditorTimelineProps = {
 segments: SourceSegment[]; captions: CaptionCue[]; hook: string; outputTime: number;
 thumbnails: EditorThumbnail[]; peaks: number[] | null; mediaLoading?: boolean;
 sourceStart?: number; sourceEnd?: number;
 cutaways?: ResolvedCutawaySpan[];
 inserts?: ResolvedInsertSpan[];
 focusSpans?: FocusSpan[];
 selection: TimelineSelection; onSelect: (selection: TimelineSelection)=>void;
 onSeek: (seconds:number)=>void; onTrim: (id:string,start:number,end:number)=>void;
 /** Drag a handle on an inserted section or overlay to make it longer or shorter. The clamp functions keep the preview inside what is allowed. */
 clampInsert?: (id:string,lengthMs:number)=>number; onResizeInsert?: (id:string,lengthMs:number)=>void;
 clampCutaway?: (id:string,startMs:number,endMs:number)=>{startMs:number;endMs:number}; onResizeCutaway?: (id:string,startMs:number,endMs:number)=>void;
 /** How long the hook stays on screen, in seconds (3 by default). Drag the handle on its right edge to stretch it, up to the whole clip. */
 hookSeconds?: number; clampHook?: (lengthMs:number)=>number; onResizeHook?: (lengthMs:number)=>void;
};
const MAX_ZOOM=8;
export default function EditorTimeline({segments,captions,hook,outputTime,thumbnails,peaks,mediaLoading,sourceStart=0,sourceEnd=Infinity,cutaways=[],inserts=[],focusSpans=[],selection,onSelect,onSeek,onTrim,clampInsert,onResizeInsert,clampCutaway,onResizeCutaway,hookSeconds=3,clampHook,onResizeHook}:EditorTimelineProps) {
 const [hookDrag,setHookDrag]=useState<number|null>(null);
 const [resize,setResize]=useState<{kind:'insert'|'cutaway';id:string;startMs:number;endMs:number}|null>(null);
 const [snapAt,setSnapAt]=useState<number|null>(null);
 const shown=(kind:'insert'|'cutaway',id:string,startMs:number,endMs:number)=>resize&&resize.kind===kind&&resize.id===id?{startMs:resize.startMs,endMs:resize.endMs}:{startMs,endMs};
 const [height,setHeight]=useState(248),[collapsed,setCollapsed]=useState(false);
 const drag=useRef<{y:number;height:number}|null>(null);
 const clampHeight=(value:number)=>Math.max(160,Math.min(Math.round(window.innerHeight*.55),430,value));
 const [zoom,setZoom]=useState(1); const track=useRef<HTMLDivElement>(null),viewport=useRef<HTMLDivElement>(null);
 const [availableWidth,setAvailableWidth]=useState(800);
 const [activeTrim,setActiveTrim]=useState<{edge:'start'|'end';start:number;end:number}|null>(null);
 useEffect(()=>{const node=viewport.current;if(!node)return;const observer=new ResizeObserver(()=>setAvailableWidth(node.clientWidth));observer.observe(node);return()=>observer.disconnect();},[]);
 const cancelTrim=useRef<(() => void) | null>(null);
 useEffect(()=>()=>cancelTrim.current?.(),[]);
 const duration=outputDuration(segments)+inserts.reduce((sum,item)=>sum+(item.end_ms-item.start_ms)/1000,0), scale=timeToPixels(1,availableWidth/Math.max(duration,.1),zoom), width=duration*scale;
 const captionGroups=groupCaptionCues(captions,zoom);
 const selectedCaptionGroup=selection?.type==='caption' ? captionGroups.find(group=>group.cues.some(cue=>cue.id===selection.id)) : undefined;
 const rulerStep=[1,2,5,10,15,30,60].find(step=>step*scale>=65)??60;
 const position=(event:React.PointerEvent)=>{const rect=track.current!.getBoundingClientRect();return Math.max(0,Math.min(duration,(event.clientX-rect.left)/scale));};
 const seek=(event:React.PointerEvent)=>{onSeek(position(event));};
 /** Zoom while keeping the playhead where it is on screen. */
 const changeZoom=(next:number)=>{const clamped=Math.min(MAX_ZOOM,Math.max(1,Math.round(next*4)/4));const node=viewport.current;
  const before=outputTime*scale-(node?.scrollLeft??0);const newScale=timeToPixels(1,availableWidth/Math.max(duration,.1),clamped);
  setZoom(clamped);if(node)requestAnimationFrame(()=>{node.scrollLeft=clamped===1?0:Math.max(0,outputTime*newScale-before);});};
 /** The nearest place a dragged edge clicks into (playhead, clip ends, cuts, inserts, overlays) within 8 pixels. */
 const snap=(seconds:number)=>nearestSnap(timelineSnapPoints({segments,inserts,cutaways,duration,outputTime}),seconds,scale);
 const outputRangeOf=(id:string)=>{let at=0;for(const s of segments){const length=s.end_seconds-s.start_seconds;if(s.id===id)return {start:at,end:at+length};at+=length+inserts.filter(i=>i.after_segment_id===s.id).reduce((n,i)=>n+(i.end_ms-i.start_ms)/1000,0);}return null;};
 let sourceOffset=0;
 const coveredSegments=segments.map((segment,index)=>{
  const start=sourceOffset;sourceOffset+=segment.end_seconds-segment.start_seconds;
  const covered=cutaways.some(c=>c.start_ms<sourceOffset*1000&&c.end_ms>start*1000);
  sourceOffset+=inserts.filter(item=>item.after_segment_id===segment.id).reduce((sum,item)=>sum+(item.end_ms-item.start_ms)/1000,0);
  return {segment,index,covered};
 }).filter(item=>item.covered);
 let offset=0;
 const blockStyle=(start:number,end:number)=>({position:'absolute' as const,left:start*scale,width:(end-start)*scale,height:'100%'});
 const trim=(event:React.PointerEvent<HTMLButtonElement>,segment:SourceSegment,edge:'start'|'end')=>{
  event.stopPropagation();cancelTrim.current?.();const element=event.currentTarget;element.setPointerCapture(event.pointerId);
  const initialX=event.clientX; const index=segments.findIndex(s=>s.id===segment.id); const lower=index?segments[index-1].end_seconds:sourceStart; const upper=segments[index+1]?.start_seconds ?? sourceEnd;
  let lastX: number | null = null;
  const move=(e:PointerEvent)=>{if(e.clientX===lastX)return;lastX=e.clientX;const delta=(e.clientX-initialX)/scale;let start=edge==='start'?Math.min(segment.end_seconds-.1,Math.max(lower,segment.start_seconds+delta)):segment.start_seconds;let end=edge==='end'?Math.max(segment.start_seconds+.1,Math.min(upper,segment.end_seconds+delta)):segment.end_seconds;
   // Clicks into the playhead when it sits inside this clip and the dragged edge comes within 8 pixels of it.
   const range=outputRangeOf(segment.id);let guide:number|null=null;
   if(range&&outputTime>=range.start&&outputTime<=range.end){const playheadSource=segment.start_seconds+(outputTime-range.start);
    if(edge==='start'&&Math.abs(start-playheadSource)*scale<=SNAP_PX&&playheadSource>=lower&&playheadSource<=segment.end_seconds-.1){start=playheadSource;guide=outputTime;}
    if(edge==='end'&&Math.abs(end-playheadSource)*scale<=SNAP_PX&&playheadSource<=upper&&playheadSource>=segment.start_seconds+.1){end=playheadSource;guide=outputTime;}}
   setSnapAt(guide);setActiveTrim({edge,start,end});onTrim(segment.id,start,end);};
  const cleanup=()=>{element.removeEventListener('pointermove',move);element.removeEventListener('pointerup',finish);element.removeEventListener('pointercancel',cleanup);element.removeEventListener('lostpointercapture',cleanup);cancelTrim.current=null;setActiveTrim(null);setSnapAt(null);};
  const finish=(e:PointerEvent)=>{move(e);cleanup();};
  cancelTrim.current=cleanup;
  setActiveTrim({edge,start:segment.start_seconds,end:segment.end_seconds});
  element.addEventListener('pointermove',move);
  element.addEventListener('pointercancel',cleanup,{once:true});element.addEventListener('lostpointercapture',cleanup,{once:true});
  element.addEventListener('pointerup',finish,{once:true});
 };
 const startResize=(event:React.PointerEvent<HTMLElement>,kind:'insert'|'cutaway',id:string,edge:'start'|'end',startMs:number,endMs:number)=>{
  event.stopPropagation();event.preventDefault();cancelTrim.current?.();
  const element=event.currentTarget;element.setPointerCapture(event.pointerId);
  const initialX=event.clientX;let latest={startMs,endMs};
  const compute=(clientX:number)=>{const delta=((clientX-initialX)/scale)*1000;
   // The dragged edge clicks into the playhead or a nearby cut; the guide line shows where.
   if(kind==='insert'){const wantedEnd=snap((endMs+delta)/1000);const wanted=wantedEnd.value*1000-startMs;const length=clampInsert?clampInsert(id,wanted):wanted;
    setSnapAt(wantedEnd.hit&&Math.abs(startMs+length-wantedEnd.value*1000)<1?wantedEnd.value:null);return {startMs,endMs:startMs+length};}
   const target=snap((edge==='start'?startMs+delta:endMs+delta)/1000);
   const wantedStart=Math.round(edge==='start'?target.value*1000:startMs),wantedEnd=Math.round(edge==='end'?target.value*1000:endMs);
   const result=clampCutaway?clampCutaway(id,wantedStart,wantedEnd):{startMs:wantedStart,endMs:wantedEnd};
   const edgeNow=edge==='start'?result.startMs:result.endMs;setSnapAt(target.hit&&Math.abs(edgeNow-target.value*1000)<1?target.value:null);return result;};
  const move=(e:PointerEvent)=>{latest=compute(e.clientX);setResize({kind,id,...latest});};
  const cleanup=()=>{element.removeEventListener('pointermove',move);element.removeEventListener('pointerup',finish);element.removeEventListener('pointercancel',cleanup);element.removeEventListener('lostpointercapture',cleanup);setResize(null);setSnapAt(null);cancelTrim.current=null;};
  const finish=(e:PointerEvent)=>{latest=compute(e.clientX);cleanup();
   if(kind==='insert'){if(latest.endMs-latest.startMs!==endMs-startMs)onResizeInsert?.(id,latest.endMs-latest.startMs);}
   else if(latest.startMs!==startMs||latest.endMs!==endMs)onResizeCutaway?.(id,latest.startMs,latest.endMs);};
  cancelTrim.current=cleanup;setResize({kind,id,startMs,endMs});
  element.addEventListener('pointermove',move);element.addEventListener('pointerup',finish,{once:true});
  element.addEventListener('pointercancel',cleanup,{once:true});element.addEventListener('lostpointercapture',cleanup,{once:true});
 };
 const resizeKey=(event:React.KeyboardEvent<HTMLElement>,kind:'insert'|'cutaway',id:string,edge:'start'|'end',startMs:number,endMs:number)=>{
  if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;event.preventDefault();event.stopPropagation();
  const delta=event.key==='ArrowRight'?100:-100;
  if(kind==='insert'){const length=clampInsert?clampInsert(id,endMs-startMs+delta):endMs-startMs+delta;if(length!==endMs-startMs)onResizeInsert?.(id,length);return;}
  const next=clampCutaway?clampCutaway(id,edge==='start'?startMs+delta:startMs,edge==='end'?endMs+delta:endMs):null;
  if(next&&(next.startMs!==startMs||next.endMs!==endMs))onResizeCutaway?.(id,next.startMs,next.endMs);
 };
 /** Drag the handle on the hook's right edge: it clicks into the playhead or a nearby cut, and stops at the end of the clip. */
 const shownHookMs=Math.min(hookDrag??Math.round(hookSeconds*1000),Math.round(duration*1000));
 const startHookResize=(event:React.PointerEvent<HTMLElement>)=>{
  event.stopPropagation();event.preventDefault();cancelTrim.current?.();
  const element=event.currentTarget;element.setPointerCapture(event.pointerId);
  const initialX=event.clientX,startMs=shownHookMs;let latest=startMs;
  const compute=(clientX:number)=>{const wanted=snap((startMs+((clientX-initialX)/scale)*1000)/1000);const ms=Math.round(wanted.value*1000);const clamped=clampHook?clampHook(ms):ms;
   setSnapAt(wanted.hit&&Math.abs(clamped-wanted.value*1000)<1?wanted.value:null);return clamped;};
  const move=(e:PointerEvent)=>{latest=compute(e.clientX);setHookDrag(latest);};
  const cleanup=()=>{element.removeEventListener('pointermove',move);element.removeEventListener('pointerup',finish);element.removeEventListener('pointercancel',cleanup);element.removeEventListener('lostpointercapture',cleanup);setHookDrag(null);setSnapAt(null);cancelTrim.current=null;};
  const finish=(e:PointerEvent)=>{latest=compute(e.clientX);cleanup();if(latest!==startMs)onResizeHook?.(latest);};
  cancelTrim.current=cleanup;setHookDrag(startMs);
  element.addEventListener('pointermove',move);element.addEventListener('pointerup',finish,{once:true});
  element.addEventListener('pointercancel',cleanup,{once:true});element.addEventListener('lostpointercapture',cleanup,{once:true});
 };
 const hookKey=(event:React.KeyboardEvent<HTMLElement>)=>{
  if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;event.preventDefault();event.stopPropagation();
  const wanted=shownHookMs+(event.key==='ArrowRight'?100:-100);const next=clampHook?clampHook(wanted):wanted;
  if(next!==shownHookMs)onResizeHook?.(next);
 };
 const handleKey=(event:React.KeyboardEvent<HTMLButtonElement>,s:SourceSegment,edge:'start'|'end')=>{
  if(event.key!=='ArrowLeft' && event.key!=='ArrowRight')return;event.preventDefault();event.stopPropagation();
  const delta=event.key==='ArrowRight'?.1:-.1; const index=segments.findIndex(item=>item.id===s.id); const lower=index?segments[index-1].end_seconds:sourceStart; const upper=segments[index+1]?.start_seconds ?? sourceEnd;
  onTrim(s.id,edge==='start'?Math.max(lower,Math.min(s.end_seconds-.1,s.start_seconds+delta)):s.start_seconds,edge==='end'?Math.min(upper,Math.max(s.start_seconds+.1,s.end_seconds+delta)):s.end_seconds);
 };
 return <section aria-label="Clip timeline" className="editor-timeline" data-collapsed={collapsed} style={{height:collapsed?44:height}}>
  <button type="button" className="editor-timeline-resize" aria-label="Resize timeline" title="Drag or use arrow keys to resize timeline" onPointerDown={e=>{if(collapsed)return;drag.current={y:e.clientY,height};e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{if(drag.current)setHeight(clampHeight(drag.current.height+drag.current.y-e.clientY));}} onPointerUp={e=>{drag.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}} onLostPointerCapture={()=>{drag.current=null;}} onKeyDown={e=>{if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();setHeight(h=>clampHeight(h+(e.key==='ArrowUp'?16:-16)));setCollapsed(false);}}}/>
  <div className="editor-timeline-topline">{collapsed&&<strong>Timeline</strong>}<button type="button" aria-label={collapsed?'Expand timeline':'Collapse timeline'} onClick={()=>setCollapsed(value=>!value)}>{collapsed?'Expand':'Collapse'}</button></div>
  <div className="editor-timeline-feedback" role="status">{hookDrag!==null ? `Hook on screen for ${(shownHookMs/1000).toFixed(1)}s of the ${duration.toFixed(1)}s clip` : activeTrim ? `Trimming ${activeTrim.edge}: ${activeTrim.start.toFixed(1)}s to ${activeTrim.end.toFixed(1)}s · ${(activeTrim.end-activeTrim.start).toFixed(1)}s selected` : `Playhead ${outputTime.toFixed(1)}s · ${duration.toFixed(1)}s clip. Drag the mint handles to trim; arrow keys adjust by 0.1s.`}</div>
  <div className="editor-timeline-heading"><span>Timeline <small>{duration.toFixed(1)}s</small></span>
   {coveredSegments.length>0&&<details className="editor-source-controls"><summary>Edit underlying source</summary><div role="group" aria-label="Underlying source clips">
    {coveredSegments.map(({segment:s,index})=><fieldset key={s.id}><legend>Source clip {index+1} · {(s.end_seconds-s.start_seconds).toFixed(1)}s</legend>
     <button type="button" aria-label={`Select source clip ${index+1}`} aria-pressed={selection?.type==='video'&&selection.id===s.id} onClick={()=>onSelect({type:'video',id:s.id})}>Select source</button>
     <button type="button" aria-label={`Trim start of source clip ${index+1}`} onPointerDown={e=>trim(e,s,'start')} onKeyDown={e=>handleKey(e,s,'start')}>Trim start</button>
     <button type="button" aria-label={`Trim end of source clip ${index+1}`} onPointerDown={e=>trim(e,s,'end')} onKeyDown={e=>handleKey(e,s,'end')}>Trim end</button>
    </fieldset>)}
   </div></details>}
   </div>
  {selectedCaptionGroup&&<div className="editor-caption-detail" aria-label="Selected caption words"><strong>Words</strong><div className="editor-caption-words">{selectedCaptionGroup.cues.map(cue=><button key={cue.id} type="button" aria-pressed={selection?.type==='caption'&&selection.id===cue.id} title={`${(cue.start_ms/1000).toFixed(1)}s – ${(cue.end_ms/1000).toFixed(1)}s`} onClick={()=>{onSelect({type:'caption',id:cue.id});onSeek(cue.start_ms/1000);}}>{cue.text}</button>)}</div><button type="button" className="editor-caption-detail-close" aria-label="Close caption words" onClick={()=>onSelect(null)}>Done</button></div>}
  <div aria-label="Short segment controls" className="editor-short-segments">
   {segments.filter(s=>(s.end_seconds-s.start_seconds)*scale<44||s.end_seconds-s.start_seconds<1.1).map((s,index)=><fieldset key={s.id}>
    <legend>Short clip {index+1}</legend>
    <button type="button" style={{minWidth:44,minHeight:44}} aria-label={`Select short segment ${s.id}`} aria-pressed={selection?.type==='video' && selection.id===s.id} onClick={()=>onSelect({type:'video',id:s.id})}>Select</button>
    <button type="button" style={{minWidth:44,minHeight:44}} aria-label={`Trim start of short segment ${s.id}`} onPointerDown={e=>trim(e,s,'start')} onKeyDown={e=>handleKey(e,s,'start')}>Start</button>
    <button type="button" style={{minWidth:44,minHeight:44}} aria-label={`Trim end of short segment ${s.id}`} onPointerDown={e=>trim(e,s,'end')} onKeyDown={e=>handleKey(e,s,'end')}>End</button>
   </fieldset>)}
  </div>
  <div className="editor-track-layout"><div className="editor-track-labels" aria-hidden="true">{focusSpans.length>0&&<p>Focus</p>}<p>Overlay</p><p>Video</p>{captions.length>0&&<p>Captions</p>}{(!!peaks?.length||mediaLoading)&&<p className="editor-audio-track-label">Audio</p>}{!!hook&&<p>Hook</p>}</div>
   <div className="editor-zoom-controls" role="group" aria-label="Timeline zoom controls">
    <button type="button" aria-label="Fit whole clip in view" disabled={zoom===1} onClick={()=>changeZoom(1)}>Fit all</button>
    <button type="button" aria-label="Zoom out" disabled={zoom<=1} onClick={()=>changeZoom(zoom-.5)}>–</button>
    <input aria-label="Timeline zoom" type="range" min="1" max={MAX_ZOOM} step="0.25" value={zoom} onChange={e=>changeZoom(Number(e.target.value))}/>
    <button type="button" aria-label="Zoom in" disabled={zoom>=MAX_ZOOM} onClick={()=>changeZoom(zoom+.5)}>+</button>
    <span aria-live="polite">{zoom.toFixed(zoom%1?2:0)}×</span>
   </div>
   <div ref={viewport} className="editor-track-scroll overflow-x-auto"><div ref={track} style={{width, minWidth:1,position:'relative'}}>
    <div className="editor-ruler" onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);seek(e);}} onPointerMove={e=>{if(e.buttons===1)seek(e);}}>
     {Array.from({length:Math.ceil(duration/(rulerStep))},(_,i)=>{const seconds=i*(rulerStep);return <span key={i} style={{left:seconds*scale}}>{Math.floor(seconds/60).toString().padStart(2,'0')}:{(seconds%60).toString().padStart(2,'0')}</span>;})}
    </div>
    {focusSpans.length>0&&<div aria-label="Focus lane" className="editor-lane editor-focus-lane">{focusSpans.map((span,index)=><button key={`${span.start_ms}:${index}`} type="button" style={blockStyle(span.start_ms/1000,span.end_ms/1000)} aria-label={`${span.mode === 'reaction' ? 'Reaction' : 'Gameplay'} focus from ${(span.start_ms/1000).toFixed(1)} to ${(span.end_ms/1000).toFixed(1)} seconds`} className={span.mode === 'reaction' ? 'reaction' : 'gameplay'} onClick={()=>onSeek(span.start_ms/1000)}>{span.mode === 'reaction' ? 'Reaction focus' : 'Gameplay focus'}</button>)}</div>}
    <div aria-label="Overlay lane" data-editor-overlay-lane="true" data-duration={duration} className="editor-lane editor-overlay-lane">{cutaways.map(c=>{const v=shown('cutaway',c.id,c.start_ms,c.end_ms);const selected=selection?.type==='cutaway'&&selection.id===c.id;return <div key={`${c.id}:${c.start_ms}`} style={blockStyle(v.startMs/1000,v.endMs/1000)} className="editor-resizable-wrap" data-selected={selected}>
     {selected&&<button type="button" className="editor-resize-handle start" aria-label={`Change start of imported media ${c.id}`} onPointerDown={e=>startResize(e,'cutaway',c.id,'start',c.start_ms,c.end_ms)} onKeyDown={e=>resizeKey(e,'cutaway',c.id,'start',c.start_ms,c.end_ms)}/>}
     <button type="button" className="editor-cutaway-block" aria-label={`Select imported media ${c.id}`} aria-pressed={selected} onClick={()=>{onSelect({type:'cutaway',id:c.id});onSeek((c.start_ms+Math.min(50,(c.end_ms-c.start_ms)/2))/1000);}}>Media <small>{((v.endMs-v.startMs)/1000).toFixed(1)}s</small></button>
     {selected&&<button type="button" className="editor-resize-handle end" aria-label={`Change end of imported media ${c.id}`} onPointerDown={e=>startResize(e,'cutaway',c.id,'end',c.start_ms,c.end_ms)} onKeyDown={e=>resizeKey(e,'cutaway',c.id,'end',c.start_ms,c.end_ms)}/>}
    </div>;})}</div>
    <div aria-label="Video lane" className="editor-lane editor-video-lane">{segments.map((s,index)=>{const start=offset;offset+=s.end_seconds-s.start_seconds;const end=offset;const after=inserts.filter(item=>item.after_segment_id===s.id);offset+=after.reduce((sum,item)=>sum+(item.end_ms-item.start_ms)/1000,0);return <Fragment key={s.id}><div style={blockStyle(start,end)} className="editor-video-block" data-selected={selection?.type==='video'&&selection.id===s.id}>
     <button type="button" aria-label={`Trim start of segment ${s.id}`} className="editor-trim-handle" onPointerDown={e=>trim(e,s,'start')} onKeyDown={e=>handleKey(e,s,'start')}/>
     <button type="button" aria-label={`Select video segment ${s.id}`} aria-pressed={selection?.type==='video' && selection.id===s.id} className="editor-video-frames" onClick={()=>onSelect({type:'video',id:s.id})}>
      {thumbnails.filter(t=>t.outputSeconds>=start && t.outputSeconds<end).map(t=><img key={t.outputSeconds} src={t.url} alt="" draggable={false} style={{left:(t.outputSeconds-start)*scale,width:2*scale}}/>)}
      <span>{thumbnails.length?`Clip ${index+1} · ${(s.end_seconds-s.start_seconds).toFixed(1)}s`:mediaLoading?'Loading frames…':'Frames unavailable'}</span>
     </button><button type="button" aria-label={`Trim end of segment ${s.id}`} className="editor-trim-handle" onPointerDown={e=>trim(e,s,'end')} onKeyDown={e=>handleKey(e,s,'end')}/>
    </div>{after.map(item=>{const v=shown('insert',item.id,item.start_ms,item.end_ms);const selected=selection?.type==='insert'&&selection.id===item.id;return <div key={item.id} style={blockStyle(v.startMs/1000,v.endMs/1000)} className="editor-resizable-wrap" data-selected={selected}>
     <button type="button" className="editor-insert-block" aria-label={`Select inserted media ${item.id}`} aria-pressed={selected} onClick={()=>{onSelect({type:'insert',id:item.id});onSeek(item.start_ms/1000);}}>Imported media <small>{((v.endMs-v.startMs)/1000).toFixed(1)}s</small></button>
     {selected&&<button type="button" className="editor-resize-handle end" aria-label={`Change length of inserted media ${item.id}`} onPointerDown={e=>startResize(e,'insert',item.id,'end',item.start_ms,item.end_ms)} onKeyDown={e=>resizeKey(e,'insert',item.id,'end',item.start_ms,item.end_ms)}/>}
    </div>;})}{index<segments.length-1&&<button type="button" data-editor-insert-after={s.id} className="editor-insert-target" style={{left:(offset-.01)*scale}} aria-label={`Insert media after clip ${index+1}`}>+</button>}</Fragment>;})}
    </div>
    {captionGroups.length>0&&<div aria-label="Caption lane" className="editor-lane editor-caption-lane">{captionGroups.map((group,index)=><button key={group.id} type="button" style={blockStyle(group.start_ms/1000,group.end_ms/1000)} className="editor-caption-group" aria-label={`Open caption phrase ${index+1}: ${group.text}`} title={group.text} aria-pressed={selectedCaptionGroup?.id===group.id} onClick={()=>{onSelect({type:'caption',id:group.cues[0].id});onSeek(group.start_ms/1000);}}><span>{group.text}</span></button>)}</div>}
    {(!!peaks?.length||mediaLoading)&&<div aria-label="Audio lane" className="editor-lane editor-audio-lane">{peaks?.length?<svg width={width} height="26" role="img" aria-label="Source audio waveform" preserveAspectRatio="none" viewBox={`0 0 ${peaks.length} 2`}><path className="editor-waveform-center" d={`M0 1 H${peaks.length}`}/><path className="editor-waveform-envelope" d={`M0 1 ${peaks.map((p,i)=>`L${i+.5} ${(1-p*.28).toFixed(3)}`).join(' ')} L${peaks.length} 1 ${peaks.map((_,i)=>`L${peaks.length-i-.5} ${(1+peaks[peaks.length-i-1]*.28).toFixed(3)}`).join(' ')} Z`}/></svg>:<span>{mediaLoading?'Loading audio…':'Waveform unavailable'}</span>}</div>}
    {!!hook&&<div aria-label="Hook lane" className="editor-lane"><div className="editor-resizable-wrap" style={blockStyle(0,Math.min(shownHookMs/1000,duration))} data-selected="true">
     <div className="editor-hook-block" style={{width:'100%',height:'100%',boxSizing:'border-box'}} title={`Hook on screen for ${(shownHookMs/1000).toFixed(1)}s`}>{hook}<small style={{marginLeft:6,opacity:.75}}>{(shownHookMs/1000).toFixed(1)}s</small></div>
     <button type="button" className="editor-resize-handle end" aria-label="Change how long the hook stays on screen" title="Drag, or use the arrow keys, to make the hook longer or shorter" onPointerDown={startHookResize} onKeyDown={hookKey}/>
    </div></div>}
    {snapAt!==null&&<div aria-hidden="true" className="editor-snap-line" style={{left:snapAt*scale}}/>}
    <div aria-hidden="true" className="editor-playhead" style={{left:outputTime*scale}}><span style={{transform:outputTime*scale<24?'none':outputTime*scale>width-24?'translateX(-100%)':'translateX(-50%)'}}>{Math.floor(outputTime/60).toString().padStart(2,'0')}:{Math.floor(outputTime%60).toString().padStart(2,'0')}</span></div>
   </div></div>
  </div>
  <input type="range" className="editor-scrubber" aria-label="Playhead position" min="0" max={duration} step="0.01" value={Math.min(outputTime,duration)} onChange={e=>onSeek(Number(e.target.value))}/>
 </section>;
}
