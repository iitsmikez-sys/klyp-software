"use client";
import { useEffect, useRef, useState } from 'react';
import { outputDuration, type CaptionCue, type SourceSegment } from '@/lib/editor-timeline';
import { timeToPixels, type EditorThumbnail } from '@/lib/editor-preview';
export type TimelineSelection = {type:'video' | 'caption'; id:string} | null;
export type EditorTimelineProps = {
 segments: SourceSegment[]; captions: CaptionCue[]; hook: string; outputTime: number;
 thumbnails: EditorThumbnail[]; peaks: number[] | null; mediaLoading?: boolean;
 sourceStart?: number; sourceEnd?: number;
 selection: TimelineSelection; onSelect: (selection: TimelineSelection)=>void;
 onSeek: (seconds:number)=>void; onTrim: (id:string,start:number,end:number)=>void;
};
export default function EditorTimeline({segments,captions,hook,outputTime,thumbnails,peaks,mediaLoading,sourceStart=0,sourceEnd=Infinity,selection,onSelect,onSeek,onTrim}:EditorTimelineProps) {
 const [zoom,setZoom]=useState(1); const track=useRef<HTMLDivElement>(null);
 const cancelTrim=useRef<(() => void) | null>(null);
 useEffect(()=>()=>cancelTrim.current?.(),[]);
 const duration=outputDuration(segments), scale=timeToPixels(1,40,zoom), width=duration*scale;
 const position=(event:React.PointerEvent)=>{const rect=track.current!.getBoundingClientRect();return Math.max(0,Math.min(duration,(event.clientX-rect.left)/scale));};
 const seek=(event:React.PointerEvent)=>{onSeek(position(event));};
 let offset=0;
 const blockStyle=(start:number,end:number)=>({position:'absolute' as const,left:start*scale,width:(end-start)*scale,height:38});
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
 return <section aria-label="Clip timeline" className="rounded-xl border border-white/10 bg-[#15171b] p-3 text-sm">
  <div className="flex justify-between mb-3"><span>Timeline · {duration.toFixed(1)}s</span><label>Zoom <input aria-label="Timeline zoom" type="range" min="0.5" max="4" step="0.25" value={zoom} onChange={e=>setZoom(Number(e.target.value))}/></label></div>
  <div aria-label="Short segment controls" className="flex flex-wrap gap-2 mb-3">
   {segments.filter(s=>(s.end_seconds-s.start_seconds)*scale<44).map(s=><fieldset key={s.id} className="flex items-center gap-1 border border-zinc-600 rounded p-1">
    <legend className="text-xs">Segment {s.id}</legend>
    <button type="button" style={{minWidth:44,minHeight:44}} aria-label={`Select short segment ${s.id}`} aria-pressed={selection?.type==='video' && selection.id===s.id} onClick={()=>onSelect({type:'video',id:s.id})}>Select</button>
    <button type="button" style={{minWidth:44,minHeight:44}} aria-label={`Trim start of short segment ${s.id}`} onPointerDown={e=>trim(e,s,'start')} onKeyDown={e=>handleKey(e,s,'start')}>Start</button>
    <button type="button" style={{minWidth:44,minHeight:44}} aria-label={`Trim end of short segment ${s.id}`} onPointerDown={e=>trim(e,s,'end')} onKeyDown={e=>handleKey(e,s,'end')}>End</button>
   </fieldset>)}
  </div>
  <div className="flex"><div className="w-20 shrink-0 pt-7 space-y-5 text-zinc-400" aria-hidden="true"><p>Video</p><p>Captions</p><p>Audio</p><p>Hook</p></div>
   <div className="overflow-x-auto flex-1"><div ref={track} style={{width, minWidth:1,position:'relative'}}>
    <div className="relative h-7" onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);seek(e);}} onPointerMove={e=>{if(e.buttons===1)seek(e);}}>
     {Array.from({length:Math.ceil(duration/5)},(_,i)=><span key={i} className="absolute text-xs text-zinc-400" style={{left:i*5*scale}}>{i*5}s</span>)}
    </div>
    <div aria-label="Video lane" className="relative h-12">{segments.map(s=>{const start=offset;offset+=s.end_seconds-s.start_seconds;return <div key={s.id} style={blockStyle(start,offset)} className={`flex overflow-hidden rounded border ${selection?.type==='video' && selection.id===s.id?'border-emerald-300':'border-zinc-600'}`}>
     <button type="button" aria-label={`Trim start of segment ${s.id}`} className="w-3 shrink-0 bg-emerald-500/60" onPointerDown={e=>trim(e,s,'start')} onKeyDown={e=>handleKey(e,s,'start')}/>
     <button type="button" aria-label={`Select video segment ${s.id}`} aria-pressed={selection?.type==='video' && selection.id===s.id} className="flex flex-1 overflow-hidden bg-zinc-800 relative" onClick={()=>onSelect({type:'video',id:s.id})}>
      {thumbnails.filter(t=>t.outputSeconds>=start && t.outputSeconds<offset).map(t=><img key={t.outputSeconds} src={t.url} alt="" draggable={false} className="absolute h-full object-cover" style={{left:(t.outputSeconds-start)*scale,width:2*scale}}/>)}
      {!thumbnails.length && <span className="m-auto text-xs">{mediaLoading?'Loading frames…':'Frames unavailable'}</span>}
     </button><button type="button" aria-label={`Trim end of segment ${s.id}`} className="w-3 shrink-0 bg-emerald-500/60" onPointerDown={e=>trim(e,s,'end')} onKeyDown={e=>handleKey(e,s,'end')}/>
    </div>;})}</div>
    <div aria-label="Caption lane" className="relative h-12">{captions.map(c=><button key={c.id} type="button" style={blockStyle(c.start_ms/1000,c.end_ms/1000)} className={`truncate rounded border px-2 text-left bg-purple-950 ${selection?.type==='caption' && selection.id===c.id?'border-emerald-300':'border-purple-700'}`} aria-pressed={selection?.type==='caption' && selection.id===c.id} onClick={()=>onSelect({type:'caption',id:c.id})}>{c.text}</button>)}</div>
    <div aria-label="Audio lane" className="relative h-12 bg-zinc-900 rounded">{peaks?.length?<svg width={width} height="38" role="img" aria-label="Source audio waveform" preserveAspectRatio="none" viewBox={`0 0 ${peaks.length} 2`}>{peaks.map((p,i)=><line key={i} x1={i+.5} x2={i+.5} y1={1-p} y2={1+p} stroke="#34d399" strokeWidth=".65"/>)}</svg>:<span className="text-xs text-zinc-400">{mediaLoading?'Loading audio…':'Waveform unavailable'}</span>}</div>
    <div aria-label="Hook lane" className="relative h-12">{hook && <div className="truncate rounded bg-amber-950 border border-amber-700 px-2" style={blockStyle(0,Math.min(3,duration))}>{hook}</div>}</div>
    <div aria-hidden="true" className="absolute top-0 bottom-0 border-l-2 border-emerald-300 pointer-events-none" style={{left:outputTime*scale}}/>
   </div></div>
  </div>
  <input type="range" className="w-full accent-emerald-400" aria-label="Playhead position" min="0" max={duration} step="0.01" value={Math.min(outputTime,duration)} onChange={e=>onSeek(Number(e.target.value))}/>
 </section>;
}
