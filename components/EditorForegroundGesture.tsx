"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { canTransformForeground, defaultForeground, fullFrameLayout, moveForeground, resizeForeground } from '@/lib/foreground-framing';
import { planVerticalLayout, type ForegroundTransform, type VerticalLayoutV1 } from '@/lib/vertical-layout';

type Point = { x: number; y: number };
type Gesture = { positions: Map<number, Point>; origin: Point; distance: number; transform: ForegroundTransform };
const distance = (a: Point, b: Point) => Math.hypot(a.x-b.x,a.y-b.y);

export default function EditorForegroundGesture({video,layout,onPreview,onCommit}: {
  video: HTMLVideoElement | null;
  layout: VerticalLayoutV1 | null;
  onPreview: (layout: VerticalLayoutV1 | null) => void;
  onCommit: (layout: VerticalLayoutV1) => void;
}) {
  const pointers=useRef(new Map<number,Point>());
  const gesture=useRef<Gesture|null>(null);
  const live=useRef<ForegroundTransform|null>(null);
  const [,setMetadataVersion]=useState(0);
  useEffect(()=>{
    if(!video)return;
    const refresh=()=>setMetadataVersion(version=>version+1);
    video.addEventListener('loadedmetadata',refresh);
    if(video.videoWidth&&video.videoHeight)refresh();
    return()=>video.removeEventListener('loadedmetadata',refresh);
  },[video]);
  if (!video?.videoWidth || !video?.videoHeight || !canTransformForeground(layout)) return null;
  const current=layout?.foreground ?? defaultForeground;
  const fit=planVerticalLayout({w:video.videoWidth,h:video.videoHeight},null,{w:1080,h:1920});
  if(fit.mode!=='full_frame') return null;
  const baseline=()=>{
    const positions=new Map(pointers.current);
    const points=[...positions.values()];
    if(!points.length){gesture.current=null;return;}
    gesture.current={positions,origin:points[0],distance:points.length>1?distance(points[0],points[1]):0,transform:live.current??current};
  };
  const preview=(next:ForegroundTransform)=>{live.current=next;onPreview(fullFrameLayout(next));};
  const down=(e:ReactPointerEvent<HTMLDivElement>)=>{
    e.currentTarget.focus();e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId,{x:e.clientX,y:e.clientY});baseline();
  };
  const move=(e:ReactPointerEvent<HTMLDivElement>)=>{
    if(!pointers.current.has(e.pointerId)||!gesture.current)return;
    pointers.current.set(e.pointerId,{x:e.clientX,y:e.clientY});
    const points=[...pointers.current.values()],start=gesture.current;
    if(points.length>1&&start.distance>0){preview(resizeForeground(start.transform,distance(points[0],points[1])/start.distance));return;}
    const rect=e.currentTarget.getBoundingClientRect();
    preview(moveForeground(start.transform,(points[0].x-start.origin.x)*1080/rect.width,(points[0].y-start.origin.y)*1920/rect.height,{w:1080,h:1920},fit.dest));
  };
  const end=(e:ReactPointerEvent<HTMLDivElement>)=>{
    if(!pointers.current.has(e.pointerId))return;
    pointers.current.delete(e.pointerId);
    if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
    if(pointers.current.size){baseline();return;}
    if(live.current){onCommit(fullFrameLayout(live.current));onPreview(null);live.current=null;}
    gesture.current=null;
  };
  const key=(e:ReactKeyboardEvent<HTMLDivElement>)=>{
    let next:ForegroundTransform|null=null;
    if(e.key==='+'||e.key==='=')next=resizeForeground(current,1.1);
    else if(e.key==='-')next=resizeForeground(current,1/1.1);
    else if(e.key.startsWith('Arrow')){
      const step=e.shiftKey?32:8;
      next=moveForeground(current,e.key==='ArrowRight'?step:e.key==='ArrowLeft'?-step:0,e.key==='ArrowDown'?step:e.key==='ArrowUp'?-step:0,{w:1080,h:1920},fit.dest);
    }
    if(next){e.preventDefault();onCommit(fullFrameLayout(next));}
  };
  return <div className="editor-foreground-gesture" tabIndex={0} aria-label="Video framing. Drag to move; pinch to resize; plus or minus to zoom; arrow keys to move." onPointerDown={down} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onKeyDown={key}><span>Drag to move · Pinch to resize</span></div>;
}
