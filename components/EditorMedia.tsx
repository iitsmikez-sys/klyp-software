"use client";
import { useEffect, useRef, useState } from 'react';
import { processingFetch } from '@/lib/processing-api';
import { decodeEditedPeaks, nextPlaybackPosition, sampleVideoFrames, seekEditedVideo, type EditorThumbnail } from '@/lib/editor-preview';
import type { SourceSegment } from '@/lib/editor-timeline';
import type { SavedClip } from '@/lib/clip-ui';
export type EditorMediaData = { thumbnails: EditorThumbnail[]; peaks: number[] | null; loading: boolean };
export type EditorMediaProps = {
 clip: SavedClip; segments: SourceSegment[]; outputTime: number; playing: boolean;
 onTimeChange: (seconds: number) => void; onPlayingChange: (playing: boolean) => void;
 onVideo?: (video: HTMLVideoElement | null) => void; onMedia?: (data: EditorMediaData) => void;
};
export default function EditorMedia({ clip, segments, outputTime, playing, onTimeChange, onPlayingChange, onVideo, onMedia }: EditorMediaProps) {
 const ref = useRef<HTMLVideoElement>(null);
 const [media, setMedia] = useState<{url:string; blob:Blob} | null>(null);
 const [error, setError] = useState<string | null>(null);
 const [attempt, setAttempt] = useState(0);
 const callbacks = useRef({onTimeChange,onPlayingChange,onVideo,onMedia}); callbacks.current={onTimeChange,onPlayingChange,onVideo,onMedia};
 const clock = useRef(outputTime);
 useEffect(() => {
  const controller = new AbortController(); let url: string | null = null; let active = true; let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 300000);
  setError(null); setMedia(null);
  processingFetch('/api/preview', {method:'POST', headers:{'Content-Type':'application/json'},body:JSON.stringify({clip_id:clip.id,url:clip.url,start_seconds:clip.start_seconds,end_seconds:clip.end_seconds,crop:false}),signal:controller.signal})
   .then(async response => { if(!response.ok) throw new Error((await response.json()).error || 'Preview failed'); return response.blob(); })
   .then(blob=>{if(!active || controller.signal.aborted)return;url=URL.createObjectURL(blob);setMedia({url,blob});})
   .catch(()=>{if(active){setError(timedOut ? 'Preview timed out. Retry to load footage.' : 'Preview unavailable. Retry to load footage.');callbacks.current.onPlayingChange(false);}})
   .finally(()=>clearTimeout(timeout));
  return ()=>{active=false;controller.abort();clearTimeout(timeout);if(url)URL.revokeObjectURL(url);};
 },[clip.id,clip.url,clip.start_seconds,clip.end_seconds,attempt]);
 useEffect(()=>{
  const controller = new AbortController();
  callbacks.current.onMedia?.({thumbnails:[],peaks:null,loading:!!media});
  if(media) Promise.all([sampleVideoFrames(media.url,segments,clip.start_seconds,controller.signal).catch(()=>[]),decodeEditedPeaks(media.blob,segments,clip.start_seconds)])
   .then(([thumbnails,peaks])=>{if(!controller.signal.aborted)callbacks.current.onMedia?.({thumbnails,peaks,loading:false});});
  return ()=>controller.abort();
 },[media,segments,clip.start_seconds]);
 useEffect(()=>{
  const video=ref.current; if(!video || !media)return;
  const publish=()=>{
   const position=nextPlaybackPosition(segments,video.currentTime+clip.start_seconds);
   if(Math.abs(video.currentTime+clip.start_seconds-position.sourceSeconds)>.001)video.currentTime=position.sourceSeconds-clip.start_seconds;
   clock.current=position.outputSeconds;callbacks.current.onTimeChange(position.outputSeconds);
   if(position.ended){video.pause();callbacks.current.onPlayingChange(false);}
  };
  let frame=0;const tick=()=>{if(!video.paused && !video.seeking)publish();frame=requestAnimationFrame(tick);};
  const ready=()=>seekEditedVideo(video,segments,clock.current,clip.start_seconds);
  video.addEventListener('loadedmetadata',ready);video.addEventListener('ended',publish);video.addEventListener('timeupdate',publish);frame=requestAnimationFrame(tick);
  callbacks.current.onVideo?.(video);
  if(video.readyState>=1)ready();
  return ()=>{cancelAnimationFrame(frame);video.removeEventListener('loadedmetadata',ready);video.removeEventListener('ended',publish);video.removeEventListener('timeupdate',publish);callbacks.current.onVideo?.(null);};
 },[media,segments,clip.start_seconds]);
 // A parent echoes published playback time through this controlled prop. Only a
 // different value requests a seek; pending loading values stay in clock for metadata.
 useEffect(()=>{const requested=outputTime!==clock.current;clock.current=outputTime;const video=ref.current;if(requested && video && video.readyState>=1)seekEditedVideo(video,segments,outputTime,clip.start_seconds);},[outputTime,segments,clip.start_seconds,media]);
 useEffect(()=>{const video=ref.current;if(!video || !media)return;if(playing)video.play().catch(()=>callbacks.current.onPlayingChange(false));else video.pause();},[playing,media]);
 return <div className="relative bg-black rounded-lg" aria-label="Source preview">
  {media && <video ref={ref} src={media.url} playsInline preload="auto" className="w-full max-h-[60vh]" onError={()=>{setError('Preview cannot be decoded. Retry to load footage.');callbacks.current.onPlayingChange(false);}} />}
  {error ? <div role="alert" className="p-4">{error} <button type="button" onClick={()=>setAttempt(x=>x+1)}>Retry preview</button></div> : !media && <p role="status" className="p-4">Loading preview…</p>}
 </div>;
}
