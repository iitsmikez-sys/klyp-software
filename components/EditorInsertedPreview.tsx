"use client";
import {useEffect,useRef,useState} from 'react';
import type {ResolvedInsertSpan} from '@/lib/editor-timeline';
import type {EditorAsset} from '@/lib/editor-assets';
import {mediaResponse} from '@/lib/editor-media-client';
import type {CutawayPicture} from './EditorCutawayPreview';

export default function EditorInsertedPreview({clipId,active,time,playing,muted,volume,onPicture,onTimeChange,onFinish}:{
 clipId:string;active:ResolvedInsertSpan|null;time:number;playing:boolean;muted:boolean;volume:number;
 onPicture:(picture:CutawayPicture|null)=>void;onTimeChange:(seconds:number)=>void;onFinish:(seconds:number)=>void;
}){
 const [preview,setPreview]=useState<{asset:EditorAsset;url:string}|null>(null),[error,setError]=useState<string|null>(null),[attempt,setAttempt]=useState(0);
 const video=useRef<HTMLVideoElement>(null),picture=useRef(onPicture),change=useRef(onTimeChange),finish=useRef(onFinish);
 const clock=useRef(time);clock.current=time;
 picture.current=onPicture;change.current=onTimeChange;finish.current=onFinish;
 const id=active?.asset_id;
 useEffect(()=>{const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;picture.current(null);setPreview(null);setError(null);if(!id)return;
  void fetch(`/api/clips/${clipId}/media/${id}`,{signal:controller.signal}).then(response=>mediaResponse<{asset:EditorAsset;preview_url:string;expires_in:number}>(response)).then(data=>{
   if(controller.signal.aborted)return;
   setPreview({asset:data.asset,url:data.preview_url});
   timer=setTimeout(()=>setAttempt(n=>n+1),Math.max(1000,data.expires_in*1000-30000));
  }).catch(e=>{if(!controller.signal.aborted)setError((e as Error).message);});
  return()=>{controller.abort();clearTimeout(timer);picture.current(null);};
 },[clipId,id,attempt]);
 const start=active?.start_ms??0,end=active?.end_ms??0,assetStart=active?.asset_in_ms??0;
 useEffect(()=>{const element=video.current;if(!element||!active||preview?.asset.kind!=='video')return;
  element.muted=muted||active.muted;element.volume=volume;
  const desired=(assetStart+Math.max(0,time*1000-start))/1000;
  if(element.readyState>=1&&Math.abs(element.currentTime-desired)>(playing?.25:.02))element.currentTime=desired;
  if(playing)void element.play().catch(()=>setError('Imported video could not play. Choose a browser-compatible MP4.'));else element.pause();
 },[active,assetStart,start,time,playing,muted,volume,preview]);
 useEffect(()=>{if(!active||preview?.asset.kind!=='photo'||!playing)return;let frame=0;let previous=performance.now();const tick=(now:number)=>{const delta=Math.min(.1,(now-previous)/1000);previous=now;const next=clock.current+delta;if(next*1000>=end)finish.current(end/1000+.001);else change.current(next);frame=requestAnimationFrame(tick);};frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);},[active,preview,playing,end]);
 if(!active)return null;
 const loaded=(element:HTMLVideoElement|HTMLImageElement)=>picture.current({assetId:active.asset_id,element});
 const fail=(message:string)=>{picture.current(null);setError(message);};
 return <div className="editor-cutaway-preview">
  {preview&&preview.asset.id===id&&(preview.asset.kind==='photo'?<img hidden src={preview.url} alt="" onLoad={e=>loaded(e.currentTarget)} onError={()=>fail('Inserted photo could not load.')}/>:<video ref={video} aria-label="Inserted video" className="editor-cutaway-video" src={preview.url} playsInline preload="auto" onLoadedData={e=>loaded(e.currentTarget)} onTimeUpdate={e=>{const next=(start+Math.max(0,(e.currentTarget.currentTime*1000-assetStart)))/1000;if(next*1000>=end-.05)finish.current(end/1000+.001);else if(playing)change.current(next);}} onEnded={()=>finish.current(end/1000+.001)} onError={()=>fail('Inserted video could not load.')}/>)}
  {error&&<div role="alert" className="editor-cutaway-status">{error}<button type="button" onClick={()=>setAttempt(n=>n+1)}>Retry inserted media</button></div>}
 </div>;
}
