"use client";
import { useEffect, useRef, useState } from 'react';
import { outputDuration, type CaptionCue, type SourceSegment, type ResolvedCutawaySpan } from '@/lib/editor-timeline';
import { timeToPixels, type EditorThumbnail } from '@/lib/editor-preview';
export type TimelineSelection = {type:'video' | 'caption' | 'cutaway'; id:string} | null;
export type EditorTimelineProps = {
 segments: SourceSegment[]; captions: CaptionCue[]; hook: string; outputTime: number;
 thumbnails: EditorThumbnail[]; peaks: number[] | null; mediaLoading?: boolean;
 sourceStart?: number; sourceEnd?: number;
 cutaways?: ResolvedCutawaySpan[];
 selection: TimelineSelection; onSelect: (selection: TimelineSelection)=>void;
 onSeek: (seconds:number)=>void; onTrim: (id:string,start:number,end:number)=>void;
};
export default function EditorTimeline({segments,captions,hook,outputTime,thumbnails,peaks,mediaLoading,sourceStart=0,sourceEnd=Infinity,cutaways=[],selection,onSelect,onSeek,onTrim}:EditorTimelineProps) {
 const [zoom,setZoom]=useState(1); const track=useRef<HTMLDivElement>(null),viewport=useRef<HTMLDivElement>(null);
 const [availableWidth,setAvailableWidth]=useState(800);
 useEffect(()=>{const node=viewport.current;if(!node)return;const observer=new ResizeObserver(()=>setAvailableWidth(node.clientWidth));observer.observe(node);return()=>observer.disconnect();},[]);
 const cancelTrim=useRef<(() => void) | null>(null);
 useEffect(()=>()=>cancelTrim.current?.(),[]);
 const duration=outputDuration(segments), scale=timeToPixels(1,availableWidth/Math.max(duration,.1),zoom), width=duration*scale;
 const rulerStep=[1,2,5,10,15,30,60].find(step=>step*scale>=65)??60;
 const position=(event:React.PointerEvent)=>{const rect=track.current!.getBoundingClientRect();return Math.max(0,Math.min(duration,(event.clientX-rect.left)/scale));};
 const seek=(event:React.PointerEvent)=>{onSeek(position(event));};
 let sourceOffset=0;
 const coveredSegments=segments.map((segment,index)=>{
  const start=sourceOffset;sourceOffset+=segment.end_seconds-segment.start_seconds;
  return {segment,index,covered:cutaways.some(c=>c.start_ms<sourceOffset*1000&&c.end_ms>start*1000)};
 }).filter(item=>item.covered);
 let offset=0;
 const blockStyle=(start:number,end:number)=>({position:'absolute' as const,left:start*scale,width:(end-start)*scale,height:44});
 const trim=(event:React.PointerEvent<HTMLButtonElement>,segment:SourceSegment,edge:'start'|'end')=>{
  event.stopPropagation();cancelTrim.current?.();const element=event.currentTarget;element.setPointerCapture(event.pointerId);
  const initialX=event.clientX; const index=segments.findIndex(s=>s.id===segment.id); const lower=index?segments[index-1].end_seconds:sourceStart; const upper=segments[index+1]?.start_seconds ?? sourceEnd;
  const move=(e:PointerEvent)=>{const delta=(e.clientX-initialX)/scale;onTrim(segment.id,edge==='start'?Math.min(segment.end_seconds-.1,Math.max(lower,segment.start_seconds+delta)):segment.start_seconds,edge==='end'?Math.max(segment.start_seconds+.1,Math.min(upper,segment.end_seconds+delta)):segment.end_seconds);};
  const cleanup=()=>{element.removeEventListener('pointerup',finish);element.removeEventListener('pointercancel',cleanup);element.removeEventListener('lostpointercapture',cleanup);cancelTrim.current=null;};
  const finish=(e:PointerEvent)=>{cleanup();move(e);};
  cancelTrim.current=cleanup;
  element.addEventListener('pointercancel',cleanup,{once:true});element.addEventListener('lostpointercapture',cleanup,{once:true});
  element.addEventListener('pointerup',finish,{once:true});
 };
 const handleKey=(event:React.KeyboardEvent<HTMLButtonElement>,s:SourceSegment,edge:'start'|'end')=>{
  if(event.key!=='ArrowLeft' && event.key!=='ArrowRight')return;event.preventDefault();event.stopPropagation();
  const delta=event.key==='ArrowRight'?.1:-.1; const index=segments.findIndex(item=>item.id===s.id); const lower=index?segments[index-1].end_seconds:sourceStart; const upper=segments[index+1]?.start_seconds ?? sourceEnd;
  onTrim(s.id,edge==='start'?Math.max(lower,Math.min(s.end_seconds-.1,s.start_seconds+delta)):s.start_seconds,edge==='end'?Math.min(upper,Math.max(s.start_seconds+.1,s.end_seconds+delta)):s.end_seconds);
 };
 return <section aria-label="Clip timeline" className="editor-timeline">
  <div className="editor-timeline-heading"><span>Timeline <small>{duration.toFixed(1)}s</small></span>
   {coveredSegments.length>0&&<details className="editor-source-controls"><summary>Edit underlying source</summary><div role="group" aria-label="Underlying source clips">
    {coveredSegments.map(({segment:s,index})=><fieldset key={s.id}><legend>Source clip {index+1} · {(s.end_seconds-s.start_seconds).toFixed(1)}s</legend>
     <button type="button" aria-label={`Select source clip ${index+1}`} aria-pressed={selection?.type==='video'&&selection.id===s.id} onClick={()=>onSelect({type:'video',id:s.id})}>Select source</button>
     <button type="button" aria-label={`Trim start of source clip ${index+1}`} onPointerDown={e=>trim(e,s,'start')} onKeyDown={e=>handleKey(e,s,'start')}>Trim start</button>
     <button type="button" aria-label={`Trim end of source clip ${index+1}`} onPointerDown={e=>trim(e,s,'end')} onKeyDown={e=>handleKey(e,s,'end')}>Trim end</button>
    </fieldset>)}
   </div></details>}
   <label>Zoom <input aria-label="Timeline zoom" type="range" min="1" max="4" step="0.25" value={zoom} onChange={e=>setZoom(Number(e.target.value))}/></label></div>
  <div aria-label="Short segment controls" className="editor-short-segments">
   {segments.filter(s=>(s.end_seconds-s.start_seconds)*scale<44||s.end_seconds-s.start_seconds<1.1).map((s,index)=><fieldset key={s.id}>
    <legend>Short clip {index+1}</legend>
    <button type="button" style={{minWidth:44,minHeight:44}} aria-label={`Select short segment ${s.id}`} aria-pressed={selection?.type==='video' && selection.id===s.id} onClick={()=>onSelect({type:'video',id:s.id})}>Select</button>
    <button type="button" style={{minWidth:44,minHeight:44}} aria-label={`Trim start of short segment ${s.id}`} onPointerDown={e=>trim(e,s,'start')} onKeyDown={e=>handleKey(e,s,'start')}>Start</button>
    <button type="button" style={{minWidth:44,minHeight:44}} aria-label={`Trim end of short segment ${s.id}`} onPointerDown={e=>trim(e,s,'end')} onKeyDown={e=>handleKey(e,s,'end')}>End</button>
   </fieldset>)}
  </div>
  <div className="editor-track-layout"><div className="editor-track-labels" aria-hidden="true"><p>Video</p><p>Captions</p><p>Audio</p><p>Hook</p></div>
   <div ref={viewport} className="editor-track-scroll overflow-x-auto"><div ref={track} style={{width, minWidth:1,position:'relative'}}>
    <div className="editor-ruler" onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);seek(e);}} onPointerMove={e=>{if(e.buttons===1)seek(e);}}>
     {Array.from({length:Math.ceil(duration/(rulerStep))},(_,i)=>{const seconds=i*(rulerStep);return <span key={i} style={{left:seconds*scale}}>{Math.floor(seconds/60).toString().padStart(2,'0')}:{(seconds%60).toString().padStart(2,'0')}</span>;})}
    </div>
    <div aria-label="Video lane" className="editor-lane editor-video-lane">{segments.map((s,index)=>{const start=offset;offset+=s.end_seconds-s.start_seconds;return <div key={s.id} style={blockStyle(start,offset)} className="editor-video-block" data-selected={selection?.type==='video'&&selection.id===s.id}>
     <button type="button" aria-label={`Trim start of segment ${s.id}`} className="editor-trim-handle" onPointerDown={e=>trim(e,s,'start')} onKeyDown={e=>handleKey(e,s,'start')}/>
     <button type="button" aria-label={`Select video segment ${s.id}`} aria-pressed={selection?.type==='video' && selection.id===s.id} className="editor-video-frames" onClick={()=>onSelect({type:'video',id:s.id})}>
      {thumbnails.filter(t=>t.outputSeconds>=start && t.outputSeconds<offset).map(t=><img key={t.outputSeconds} src={t.url} alt="" draggable={false} style={{left:(t.outputSeconds-start)*scale,width:2*scale}}/>)}
      <span>{thumbnails.length?`Clip ${index+1} · ${(s.end_seconds-s.start_seconds).toFixed(1)}s`:mediaLoading?'Loading frames…':'Frames unavailable'}</span>
     </button><button type="button" aria-label={`Trim end of segment ${s.id}`} className="editor-trim-handle" onPointerDown={e=>trim(e,s,'end')} onKeyDown={e=>handleKey(e,s,'end')}/>
    </div>;})}
    <div aria-label="Imported media lane" className="editor-imported-lane">{cutaways.map(c=><button key={`${c.id}:${c.start_ms}`} type="button" style={blockStyle(c.start_ms/1000,c.end_ms/1000)} className="editor-cutaway-block" aria-label={`Select cutaway ${c.id}`} aria-pressed={selection?.type==='cutaway'&&selection.id===c.id} onClick={()=>{onSelect({type:'cutaway',id:c.id});onSeek(c.start_ms/1000);}}>Imported media <small>{((c.end_ms-c.start_ms)/1000).toFixed(1)}s</small></button>)}</div></div>
    <div aria-label="Caption lane" className="editor-lane">{captions.map(c=><button key={c.id} type="button" style={blockStyle(c.start_ms/1000,c.end_ms/1000)} className="editor-caption-block" aria-pressed={selection?.type==='caption' && selection.id===c.id} onClick={()=>onSelect({type:'caption',id:c.id})}>{c.text}</button>)}</div>
    <div aria-label="Audio lane" className="editor-lane editor-audio-lane">{peaks?.length?<svg width={width} height="44" role="img" aria-label="Source audio waveform" preserveAspectRatio="none" viewBox={`0 0 ${peaks.length} 2`}>{peaks.map((p,i)=><line key={i} x1={i+.5} x2={i+.5} y1={1-p} y2={1+p} stroke="#34d399" strokeWidth=".65"/>)}</svg>:<span>{mediaLoading?'Loading audio…':'Waveform unavailable'}</span>}</div>
    <div aria-label="Hook lane" className="editor-lane">{hook && <div className="editor-hook-block" style={blockStyle(0,Math.min(3,duration))}>{hook}</div>}</div>
    <div aria-hidden="true" className="editor-playhead" style={{left:outputTime*scale}}><span style={{transform:outputTime*scale<24?'none':outputTime*scale>width-24?'translateX(-100%)':'translateX(-50%)'}}>{Math.floor(outputTime/60).toString().padStart(2,'0')}:{Math.floor(outputTime%60).toString().padStart(2,'0')}</span></div>
   </div></div>
  </div>
  <input type="range" className="editor-scrubber" aria-label="Playhead position" min="0" max={duration} step="0.01" value={Math.min(outputTime,duration)} onChange={e=>onSeek(Number(e.target.value))}/>
 </section>;
}
