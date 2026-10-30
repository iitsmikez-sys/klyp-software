"use client";

import { useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { editorOverlayAtTime } from '@/lib/editor-captions';
import { editorCaptionPlacement, editorHookPlacement } from '@/lib/editor-text-placement';
import { moveTextPlacement, resizeTextPlacement, type TextPlacement } from '@/lib/text-placement';
import { previewDimensions } from '@/lib/vertical-layout';
import type { VerticalLayoutV1 } from '@/lib/vertical-layout';
import type { ClipEditDraftV3 } from '@/lib/clip-edit-draft';
import type { SavedClip } from '@/lib/clip-ui';

type Kind='hook'|'caption';
type Point={x:number;y:number};
type PlacementChange=Pick<ClipEditDraftV3,'hook_placement'|'caption_placement'>;
const distance=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);

function TextHandle({kind,placement,onPreview,onCommit}: {
  kind:Kind; placement:TextPlacement;
  onPreview:(change:PlacementChange|null)=>void;
  onCommit:(change:PlacementChange)=>void;
}) {
  const [selected,setSelected]=useState(false);
  const pointers=useRef(new Map<number,Point>());
  const origin=useRef<{first:Point;distance:number;placement:TextPlacement;resize:boolean}|null>(null);
  const live=useRef<TextPlacement|null>(null);
  const key=kind==='hook'?'hook_placement':'caption_placement';
  const start= (resize=false)=>{
    const points=[...pointers.current.values()];
    if(!points.length){origin.current=null;return;}
    origin.current={first:points[0],distance:points.length>1?distance(points[0],points[1]):0,placement:live.current??placement,resize};
  };
  const preview=(next:TextPlacement)=>{live.current=next;onPreview({[key]:next});};
  const down=(e:ReactPointerEvent<HTMLDivElement>)=>{
    e.stopPropagation();setSelected(true);e.currentTarget.focus();
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId,{x:e.clientX,y:e.clientY});
    start((e.target as HTMLElement).closest('[data-text-resize]')!==null);
  };
  const move=(e:ReactPointerEvent<HTMLDivElement>)=>{
    if(!pointers.current.has(e.pointerId)||!origin.current)return;
    pointers.current.set(e.pointerId,{x:e.clientX,y:e.clientY});
    const points=[...pointers.current.values()],from=origin.current;
    if(points.length>1&&from.distance>0){preview(resizeTextPlacement(from.placement,distance(points[0],points[1])/from.distance));return;}
    if(from.resize){preview(resizeTextPlacement(from.placement,1+((points[0].x-from.first.x)+(points[0].y-from.first.y))/120));return;}
    const canvas=e.currentTarget.closest('.editor-text-placement-layer')?.getBoundingClientRect();
    if(!canvas)return;
    preview(moveTextPlacement(from.placement,(points[0].x-from.first.x)/canvas.width,(points[0].y-from.first.y)/canvas.height));
  };
  const end=(e:ReactPointerEvent<HTMLDivElement>)=>{
    if(!pointers.current.has(e.pointerId))return;
    pointers.current.delete(e.pointerId);
    if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
    if(pointers.current.size){start();return;}
    if(live.current){onCommit({[key]:live.current});onPreview(null);live.current=null;}
    origin.current=null;
  };
  const keyboard=(e:ReactKeyboardEvent<HTMLDivElement>)=>{
    const step=e.shiftKey ? 0.05 : 0.01;
    let next:TextPlacement|null=null;
    if(e.key==='+'||e.key==='=')next=resizeTextPlacement(placement,1.1);
    else if(e.key==='-')next=resizeTextPlacement(placement,1/1.1);
    else if(e.key.startsWith('Arrow'))next=moveTextPlacement(placement,e.key==='ArrowRight'?step:e.key==='ArrowLeft'?-step:0,e.key==='ArrowDown'?step:e.key==='ArrowUp'?-step:0);
    if(next){e.preventDefault();onCommit({[key]:next});}
  };
  return <div className={`editor-text-handle ${selected?'is-selected':''}`} data-text-kind={kind} style={{left:`${placement.x*100}%`,top:`${placement.y*100}%`,width:`${Math.max(18,Math.min(72,2*Math.min(placement.x,1-placement.x)*100-4))}%`,height:`${Math.max(38,40*placement.scale)}px`}} tabIndex={0} role="button" aria-label={`Move or resize ${kind}. Drag to move, drag corner or pinch to resize, arrow keys to move, plus or minus to resize.`} onPointerDown={down} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onKeyDown={keyboard}>
    <span className="editor-text-handle-label">{kind==='hook'?'Hook':'Captions'}</span><span className="editor-text-resize-handle" data-text-resize aria-hidden="true">↘</span>
  </div>;
}

export default function EditorTextPlacementOverlay({draft,clip,time,video,layout,onPreview,onCommit}: {
  draft:ClipEditDraftV3;clip:SavedClip;time:number;video:HTMLVideoElement|null;layout:VerticalLayoutV1|null;
  onPreview:(change:PlacementChange|null)=>void;
  onCommit:(change:PlacementChange)=>void;
}) {
  const layer=useRef<HTMLDivElement>(null);
  const [frame,setFrame]=useState<{left:number;top:number;width:number;height:number}|null>(null);
  const source=video?.videoWidth&&video?.videoHeight?{w:video.videoWidth,h:video.videoHeight}:{w:1920,h:1080};
  const dimensions=previewDimensions(source,draft.aspect_ratio);
  useLayoutEffect(()=>{
    const parent=layer.current?.parentElement;
    if(!parent)return;
    const update=()=>{
      const width=parent.clientWidth,height=parent.clientHeight;
      if(!width||!height)return;
      const scale=Math.min(width/dimensions.w,height/dimensions.h);
      const fittedWidth=dimensions.w*scale,fittedHeight=dimensions.h*scale;
      setFrame({left:(width-fittedWidth)/2,top:(height-fittedHeight)/2,width:fittedWidth,height:fittedHeight});
    };
    const observer=new ResizeObserver(update);
    observer.observe(parent);
    update();
    return()=>observer.disconnect();
  },[dimensions.w,dimensions.h]);
  const active=editorOverlayAtTime(draft,clip,time);
  const hookPlacement=editorHookPlacement(draft,video?.videoWidth&&video?.videoHeight?{w:video.videoWidth,h:video.videoHeight}:null);
  const captionPlacement=editorCaptionPlacement(draft,clip,time,video?.videoWidth&&video?.videoHeight?{w:video.videoWidth,h:video.videoHeight}:null,layout);
  return <div ref={layer} className="editor-text-placement-layer" aria-label="Text placement controls" style={frame?{left:frame.left,top:frame.top,width:frame.width,height:frame.height}: {visibility:'hidden'}}>
    {active.hook && <TextHandle kind="hook" placement={hookPlacement} onPreview={onPreview} onCommit={onCommit}/>}
    {active.caption && <TextHandle kind="caption" placement={captionPlacement} onPreview={onPreview} onCommit={onCommit}/>}
  </div>;
}
