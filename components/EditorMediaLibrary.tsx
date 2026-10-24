"use client";
import { useRef } from 'react';
import EditorIcon from './EditorIcon';
import type { EditorAsset } from '@/lib/editor-assets';
import type { UploadPhase } from '@/lib/editor-media-client';
export default function EditorMediaLibrary({assets,loading,error,upload,onFile,onInsert,onRetry,onGate,disabled,compact=false}: {
 compact?:boolean;
 assets:EditorAsset[]; loading:boolean; error:string|null; upload:UploadPhase|null;
 onFile:(file:File,kind:'photo'|'video')=>void; onInsert:(asset:EditorAsset)=>void; onRetry:()=>void; onGate:()=>void; disabled:boolean;
}) {
 const photo=useRef<HTMLInputElement>(null),video=useRef<HTMLInputElement>(null);
 const choose=(kind:'photo'|'video')=>{if(disabled){onGate();return;}(kind==='photo'?photo:video).current?.click();};
 return <section className={`editor-media-library${compact?' editor-media-compact':''}`} aria-label="Media library">
  {!compact&&<><h2>Your media</h2><p>Add a visual cutaway. Your stream audio keeps playing.</p></>}
  <div className="editor-media-actions"><button type="button" disabled={!!upload} onClick={()=>choose('photo')}><EditorIcon name="photo"/>Add photo</button><button type="button" disabled={!!upload} onClick={()=>choose('video')}><EditorIcon name="video"/>Add video</button></div>
  <input hidden ref={photo} type="file" aria-label="Choose photo" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" disabled={disabled||!!upload} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)onFile(file,'photo');}}/>
  <input hidden ref={video} type="file" aria-label="Choose video" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm" disabled={disabled||!!upload} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)onFile(file,'video');}}/>
  {!compact&&<p>Photos up to 10 MB · Videos up to 50 MB / 60 seconds. Imported videos are muted.</p>}
  {upload&&<p role="status">{upload==='preparing'?'Preparing upload…':upload==='uploading'?'Uploading file…':'Verifying media…'}</p>}
  {loading&&!compact&&<p role="status">Loading imported media…</p>}
  {error&&<div role="alert">{error}<button type="button" disabled={!!upload} onClick={onRetry}>Retry media</button><p>If an upload failed, choose the file again.</p></div>}
  {!compact&&!loading&&!assets.length&&!error&&<p className="editor-media-empty">Your imported photos and videos will appear here.</p>}
  {!compact&&<ul>{assets.filter(a=>a.status==='verified').map(asset=><li key={asset.id}><EditorIcon name={asset.kind==='photo'?'photo':'video'}/><span>{asset.file_name}<small>{asset.kind==='photo'?'Photo':'Muted video'}{asset.duration_ms!==null&&` · ${(asset.duration_ms/1000).toFixed(1)}s`}</small></span><button type="button" onClick={()=>disabled?onGate():onInsert(asset)} aria-label={`Insert ${asset.file_name}`}>Insert at playhead</button></li>)}</ul>}
 </section>;
}
