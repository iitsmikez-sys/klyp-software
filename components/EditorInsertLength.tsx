"use client";
import { useEffect, useState } from 'react';

/** Length of an inserted photo or video, in seconds. Applies on Enter or when the field loses focus. */
export default function EditorInsertLength({valueMs,minMs,maxMs,onApply}:{valueMs:number;minMs:number;maxMs:number;onApply:(ms:number)=>void}) {
 const [text,setText]=useState((valueMs/1000).toFixed(1));
 useEffect(()=>{setText((valueMs/1000).toFixed(1));},[valueMs]);
 const apply=()=>{const seconds=Number(text);if(!Number.isFinite(seconds)){setText((valueMs/1000).toFixed(1));return;}onApply(Math.round(seconds*1000));};
 return <label className="editor-insert-length">Length (seconds)
  <input aria-label="Inserted media length in seconds" type="number" step="0.1" min={minMs/1000} max={maxMs/1000} value={text}
   onChange={e=>setText(e.target.value)} onBlur={apply} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();apply();}}}/>
  <small>Between {(minMs/1000).toFixed(1)}s and {(maxMs/1000).toFixed(1)}s</small>
 </label>;
}
