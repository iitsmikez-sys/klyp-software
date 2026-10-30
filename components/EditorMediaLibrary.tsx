"use client";
import { useEffect,useRef,useState } from 'react';
import EditorIcon from './EditorIcon';
import type { EditorAsset } from '@/lib/editor-assets';
import type { UploadPhase } from '@/lib/editor-media-client';
export default function EditorMediaLibrary({assets,loading,error,upload,onFile,onInsert,onInsertAfter,onDrop,onRetry,onGate,disabled,compact=false,canInsert=false}: {
 compact?:boolean;
 assets:EditorAsset[]; loading:boolean; error:string|null; upload:UploadPhase|null;
 onFile:(file:File,kind:'photo'|'video')=>void; onInsert:(asset:EditorAsset)=>void; onInsertAfter?:(asset:EditorAsset)=>void; onDrop?:(asset:EditorAsset,target:{kind:'overlay';time:number}|{kind:'insert';afterSegmentId:string})=>void; onRetry:()=>void; onGate:()=>void; disabled:boolean;canInsert?:boolean;
}) {
 const photo=useRef<HTMLInputElement>(null),video=useRef<HTMLInputElement>(null);
 const [dragPoint,setDragPoint]=useState<{x:number;y:number;name:string}|null>(null);
 const pointer=useRef<{x:number;y:number}|null>(null);
 useEffect(()=>{if(!dragPoint)return;let frame=0;const scroll=()=>{const point=pointer.current;if(point){const edge=64,step=15;const amount=point.y>window.innerHeight-edge?step:point.y<edge?-step:0;if(amount){const editor=document.querySelector<HTMLElement>('.clip-editor');if(editor&&editor.scrollHeight>editor.clientHeight)editor.scrollTop+=amount;else window.scrollBy(0,amount);}}frame=requestAnimationFrame(scroll);};frame=requestAnimationFrame(scroll);return()=>cancelAnimationFrame(frame);},[!!dragPoint]);
 const choose=(kind:'photo'|'video')=>{if(disabled){onGate();return;}(kind==='photo'?photo:video).current?.click();};
 return <section className={`editor-media-library${compact?' editor-media-compact':''}`} aria-label="Media library">
  {!compact&&<><h2>Your media</h2><p>Drag a file onto Overlay, or between split clips on Video. Imported video sections play their own audio.</p></>}
  <div className="editor-media-actions"><button type="button" disabled={!!upload} onClick={()=>choose('photo')}><EditorIcon name="photo"/>Add photo</button><button type="button" disabled={!!upload} onClick={()=>choose('video')}><EditorIcon name="video"/>Add video</button></div>
  <input hidden ref={photo} type="file" aria-label="Choose photo" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" disabled={disabled||!!upload} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)onFile(file,'photo');}}/>
  <input hidden ref={video} type="file" aria-label="Choose video" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm" disabled={disabled||!!upload} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)onFile(file,'video');}}/>
  {!compact&&<p>Photos up to 10 MB · Videos up to 50 MB / 60 seconds.</p>}
  {upload&&<p role="status">{upload==='preparing'?'Preparing upload…':upload==='uploading'?'Uploading file…':'Verifying media…'}</p>}
  {loading&&!compact&&<p role="status">Loading imported media…</p>}
  {error&&<div role="alert">{error}<button type="button" disabled={!!upload} onClick={onRetry}>Retry media</button><p>If an upload failed, choose the file again.</p></div>}
  {!compact&&!loading&&!assets.length&&!error&&<p className="editor-media-empty">Your imported photos and videos will appear here.</p>}
  {!compact&&<ul>{assets.filter(a=>a.status==='verified').map(asset=><li key={asset.id}><EditorIcon name={asset.kind==='photo'?'photo':'video'}/><span>{asset.file_name}<small>{asset.kind==='photo'?'Photo':'Video'}{asset.duration_ms!==null&&` · ${(asset.duration_ms/1000).toFixed(1)}s`}</small></span><button type="button" onClick={()=>disabled?onGate():onInsert(asset)} aria-label={`Overlay ${asset.file_name}`}>Add to Overlay</button><button type="button" disabled={!canInsert} onClick={()=>disabled?onGate():onInsertAfter?.(asset)} aria-label={`Insert ${asset.file_name} after selected clip`}>Insert between clips</button><button type="button" className="editor-media-drag" aria-label={`Drag ${asset.file_name} to timeline`} onPointerDown={e=>{if(disabled){onGate();return;}e.currentTarget.setPointerCapture(e.pointerId);pointer.current={x:e.clientX,y:e.clientY};setDragPoint({x:e.clientX,y:e.clientY,name:asset.file_name});}} onPointerMove={e=>{if(!pointer.current)return;pointer.current={x:e.clientX,y:e.clientY};setDragPoint({x:e.clientX,y:e.clientY,name:asset.file_name});}} onPointerCancel={()=>{pointer.current=null;setDragPoint(null);}} onPointerUp={e=>{pointer.current=null;setDragPoint(null);if(disabled)return;const hit=document.elementFromPoint(e.clientX,e.clientY) as HTMLElement|null;const lane=hit?.closest<HTMLElement>('[data-editor-overlay-lane]');if(lane){const rect=lane.getBoundingClientRect();const time=Math.max(0,Math.min(Number(lane.dataset.duration)-.1,(e.clientX-rect.left)/rect.width*Number(lane.dataset.duration)));onDrop?.(asset,{kind:'overlay',time});return;}const target=hit?.closest<HTMLElement>('[data-editor-insert-after]');if(target?.dataset.editorInsertAfter)onDrop?.(asset,{kind:'insert',afterSegmentId:target.dataset.editorInsertAfter});}}>Drag to timeline</button></li>)}</ul>}
  {dragPoint&&<div className="editor-media-ghost" style={{left:dragPoint.x+12,top:dragPoint.y+12}}>{dragPoint.name}</div>}
 </section>;
}
