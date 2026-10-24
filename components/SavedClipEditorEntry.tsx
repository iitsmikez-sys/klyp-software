"use client";
import {useEffect,useState} from 'react';
import type {SavedClip} from '@/lib/clip-ui';
import {hasLegacyEditorDraft} from '@/lib/editor-compatibility';
import ClipTimelineEditor from './ClipTimelineEditor';
import LegacySavedClipEditor from './LegacySavedClipEditor';
export default function SavedClipEditorEntry({clip}:{clip:SavedClip}) {
 const [mode,setMode]=useState<'loading'|'legacy'|'timeline'>('loading');
 const [hasLegacy,setHasLegacy]=useState(false);
 useEffect(()=>{let found=false;try{found=hasLegacyEditorDraft(localStorage.getItem('klyp-editor-'+clip.id));}catch{}setHasLegacy(found);setMode(found?'legacy':'timeline');},[clip.id]);
 if(mode==='loading')return <p role="status">Loading your saved edits…</p>;
 const banner=hasLegacy?<section aria-label="Saved device edits" className="p-4 border-b border-border bg-surface text-foreground shrink-0"><p>Your edits saved on this device are available in the original editor. The new timeline keeps a separate saved draft.</p><button type="button" className="mt-2 px-4 py-2 border border-border rounded" onClick={()=>{if(mode==='timeline'&&!window.confirm('Leave the new timeline? Unsaved timeline changes will be lost.'))return;setMode(mode==='legacy'?'timeline':'legacy');}}>{mode==='legacy'?'Open new timeline':'Return to saved device edits'}</button></section>:null;
 return mode==='legacy'?<>{banner}<LegacySavedClipEditor key={clip.id} clip={clip} workspace/></>:<ClipTimelineEditor key={clip.id} clip={clip} compatibilityNotice={banner}/>;
}
