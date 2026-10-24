"use client";
import { useEffect, useState } from 'react';
import type { EditorAsset } from '@/lib/editor-assets';
import type { ClipEditDraftV3, VisualCutaway } from '@/lib/clip-edit-draft';
import { resolveCutawaySpans } from '@/lib/editor-timeline';
import { updateCutawayInterval } from '@/lib/editor-media-client';
export default function EditorCutawayInspector({draft,cutaway,asset,onChange,onRemove,disabled}: {draft:ClipEditDraftV3;cutaway:VisualCutaway;asset?:EditorAsset;onChange:(cutaway:VisualCutaway)=>void;onRemove:()=>void;disabled:boolean}) {
 const spans=resolveCutawaySpans(draft).filter(s=>s.id===cutaway.id);
 const first=spans[0]?.start_ms??0,last=spans.at(-1)?.end_ms??0;
 const visibleOffset=spans[0]?.asset_in_ms??cutaway.asset_in_ms;
 const [start,setStart]=useState(first/1000),[end,setEnd]=useState(last/1000),[offset,setOffset]=useState(visibleOffset/1000),[error,setError]=useState<string|null>(null);
 useEffect(()=>{setStart(first/1000);setEnd(last/1000);setOffset(visibleOffset/1000);setError(null);},[first,last,cutaway.id,visibleOffset]);
 const apply=()=>{try{if(!asset)throw new Error('Media unavailable. Reload the media library to edit timing.');onChange(updateCutawayInterval(draft,cutaway,asset,start,end,offset));setError(null);}catch(e){setError((e as Error).message);}};
 return <aside className="editor-inspector" aria-label="Cutaway inspector"><h2>Imported cutaway</h2><p>{asset?.file_name||'Imported media'}</p><p>The original stream audio continues. Imported video audio is muted.</p>
 {!spans.length&&<p role="status">The footage this cutaway covered has been removed. Reposition it or remove it.</p>}
 <fieldset disabled={disabled}><div className="editor-times"><label>Output start<input aria-label="Cutaway start" type="number" step="0.1" min="0" value={start} onChange={e=>setStart(Number(e.target.value))}/></label><label>Output end<input aria-label="Cutaway end" type="number" step="0.1" min="0" value={end} onChange={e=>setEnd(Number(e.target.value))}/></label></div>
 {asset?.kind==='video'&&<label>Imported video start<input aria-label="Imported video start" type="number" step="0.1" min="0" value={offset} onChange={e=>setOffset(Number(e.target.value))}/></label>}
 <button type="button" onClick={apply}>Apply cutaway timing</button>
 <label>Fit<select aria-label="Cutaway fit" value={cutaway.fit} onChange={e=>onChange({...cutaway,fit:e.target.value as 'cover'|'contain'})}><option value="cover">Fill frame</option><option value="contain">Fit inside frame</option></select></label>
 {(['x','y'] as const).map(axis=><label key={axis}>Position {axis==='x'?'horizontal':'vertical'}<input aria-label={`Cutaway ${axis==='x'?'horizontal':'vertical'} position`} type="range" min="0" max="1" step="0.01" value={cutaway.focal_point[axis]} onChange={e=>onChange({...cutaway,focal_point:{...cutaway.focal_point,[axis]:Number(e.target.value)}})}/></label>)}
 <button type="button" onClick={onRemove}>Remove cutaway</button></fieldset>{error&&<p role="alert">{error}</p>}
 </aside>;
}
