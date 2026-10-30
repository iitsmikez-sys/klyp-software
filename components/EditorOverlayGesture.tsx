"use client";
import {useEffect,useRef,useState,type PointerEvent} from 'react';
import type {VisualCutaway} from '@/lib/clip-edit-draft';

type Rect=NonNullable<VisualCutaway['rect']>;
const clamp=(v:number,min:number,max:number)=>Math.max(min,Math.min(max,v));
export default function EditorOverlayGesture({overlay,onCommit,onSelect}:{overlay:VisualCutaway;onCommit:(next:VisualCutaway)=>void;onSelect:()=>void}){
 const [rect,setRect]=useState<Rect>(overlay.rect!);
 const ref=useRef<HTMLDivElement>(null),drag=useRef<{id:number;mode:'move'|'resize';x:number;y:number;start:Rect}|null>(null);
 useEffect(()=>{if(!drag.current)setRect(overlay.rect!);},[overlay.rect]);
 const start=(event:PointerEvent<HTMLDivElement>,mode:'move'|'resize')=>{event.preventDefault();event.stopPropagation();onSelect();drag.current={id:event.pointerId,mode,x:event.clientX,y:event.clientY,start:rect};event.currentTarget.setPointerCapture(event.pointerId);};
 const moved=(event:PointerEvent<HTMLDivElement>):Rect|null=>{const current=drag.current,host=ref.current?.parentElement;if(!current||current.id!==event.pointerId||!host)return null;
  const dx=(event.clientX-current.x)/host.clientWidth,dy=(event.clientY-current.y)/host.clientHeight;
  return current.mode==='move'?{...current.start,x:clamp(current.start.x+dx,0,1-current.start.w),y:clamp(current.start.y+dy,0,1-current.start.h)}:{...current.start,w:clamp(current.start.w+dx,.05,1-current.start.x),h:clamp(current.start.h+dy,.05,1-current.start.y)};
 };
 const move=(event:PointerEvent<HTMLDivElement>)=>{const next=moved(event);if(next)setRect(next);};
 const end=(event:PointerEvent<HTMLDivElement>)=>{if(drag.current?.id!==event.pointerId)return;const next=moved(event)??rect;drag.current=null;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);setRect(next);onCommit({...overlay,rect:next});};
 return <div ref={ref} className="editor-overlay-gesture" style={{left:`${rect.x*100}%`,top:`${rect.y*100}%`,width:`${rect.w*100}%`,height:`${rect.h*100}%`}} aria-label="Move imported overlay" onPointerDown={e=>start(e,'move')} onPointerMove={move} onPointerUp={end} onPointerCancel={end}><span>Drag to move</span><div className="editor-overlay-resize" role="button" tabIndex={0} aria-label="Resize imported overlay" onPointerDown={e=>start(e,'resize')} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onKeyDown={e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'||e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();onCommit({...overlay,rect:{...rect,w:clamp(rect.w+(e.key==='ArrowRight'?.02:e.key==='ArrowLeft'?-.02:0),.05,1-rect.x),h:clamp(rect.h+(e.key==='ArrowDown'?.02:e.key==='ArrowUp'?-.02:0),.05,1-rect.y)}});}}}/></div>;
}
