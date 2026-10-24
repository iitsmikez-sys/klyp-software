"use client";
import { useEffect, useRef, useState } from 'react';
import type { EditorAsset } from '@/lib/editor-assets';
import type { ResolvedCutawaySpan } from '@/lib/editor-timeline';
import { mediaResponse } from '@/lib/editor-media-client';
export type CutawayPicture = {assetId:string;element:HTMLImageElement|HTMLVideoElement};
type Preview = {asset:EditorAsset;url:string;expires:number};
export default function EditorCutawayPreview({clipId,active,outputTime,playing,sourceVideo,onPicture}: {clipId:string;active:ResolvedCutawaySpan|null;outputTime:number;playing:boolean;sourceVideo:HTMLVideoElement|null;onPicture:(picture:CutawayPicture|null)=>void}) {
 const cache=useRef(new Map<string,Preview>()),video=useRef<HTMLVideoElement>(null);
 const lastSeek=useRef<{video:HTMLVideoElement;target:number;running:boolean}|null>(null);
 const [preview,setPreview]=useState<Preview|null>(null),[error,setError]=useState<string|null>(null),[ready,setReady]=useState(false),[attempt,setAttempt]=useState(0);
 const state=useRef({active,outputTime,playing,sourceVideo,onPicture});state.current={active,outputTime,playing,sourceVideo,onPicture};
 const assetId=active?.asset_id;
 useEffect(()=>{cache.current.clear();},[clipId]);
 useEffect(()=>{
  const controller=new AbortController();let live=true;let timer:ReturnType<typeof setTimeout>;
  setPreview(null);setReady(false);setError(null);state.current.onPicture(null);
  if(!assetId)return;
  const load=async()=>{try{
   let item=cache.current.get(assetId);
   if(!item||item.expires<=Date.now()+30000){const data=await mediaResponse<{asset:EditorAsset;preview_url:string;expires_in:number}>(await fetch(`/api/clips/${clipId}/media/${assetId}`,{signal:controller.signal}));if(!live)return;item={asset:data.asset,url:data.preview_url,expires:Date.now()+data.expires_in*1000};cache.current.set(assetId,item);}
   if(!live)return;setPreview(item);timer=setTimeout(()=>{cache.current.delete(assetId);setAttempt(n=>n+1);},Math.max(1000,item.expires-Date.now()-30000));
  }catch(e){if(live)setError((e as Error).message);}};
  void load();return()=>{live=false;controller.abort();clearTimeout(timer);state.current.onPicture(null);};
 },[assetId,clipId,attempt]);
 const sync=()=>{
  const v=video.current,{active,outputTime,playing,sourceVideo}=state.current;if(!v||!active||v.readyState<1)return;
  const desired=(active.asset_in_ms+outputTime*1000-active.start_ms)/1000;
  const running=playing&&!!sourceVideo&&!sourceVideo.paused&&!sourceVideo.seeking&&sourceVideo.readyState>=3;
  // Some containers cannot land exactly at zero (their first presentation frame
  // starts later). Retry a paused seek only when the requested position changes,
  // otherwise repeated seeks prevent any decoded frame from reaching the canvas.
  const previous=lastSeek.current;
  const requested=running||previous?.video!==v||previous.running||Math.abs(previous.target-desired)>.001;
  if(!v.seeking&&requested){lastSeek.current={video:v,target:desired,running};if(Math.abs(v.currentTime-desired)>(running?.12:.005))v.currentTime=Math.max(0,desired);}
  if(running){if(v.paused)void v.play().catch(()=>{setError('This imported video cannot play in this browser. Retry or choose an MP4 with a supported codec.');});}else v.pause();
 };
 useEffect(()=>{let frame=0;const tick=()=>{sync();frame=requestAnimationFrame(tick);};frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);},[preview]);
 useEffect(()=>{sync();},[outputTime,playing,active]);
 if(!active)return null;
 const fail=()=>{setReady(false);state.current.onPicture(null);setError('Imported media could not be decoded or its link expired. Retry, or choose a browser-compatible file.');};
 const loaded=(element:HTMLImageElement|HTMLVideoElement)=>{sync();setReady(true);setError(null);onPicture({assetId:active.asset_id,element});};
 return <div className="editor-cutaway-preview">
  {preview&&preview.asset.id===assetId&&(preview.asset.kind==='photo'?<img hidden src={preview.url} alt="" onLoad={e=>loaded(e.currentTarget)} onError={fail}/>:<video ref={video} aria-label="Imported video" className="editor-cutaway-video" src={preview.url} muted playsInline preload="auto" onLoadedMetadata={sync} onLoadedData={e=>loaded(e.currentTarget)} onError={fail}/>)}
  {error?<div className="editor-cutaway-status" role="alert">{error}<button type="button" onClick={()=>{cache.current.delete(active.asset_id);setAttempt(n=>n+1);}}>Retry imported media</button></div>:!ready&&<p className="editor-cutaway-status" role="status">Loading imported media…</p>}
 </div>;
}
