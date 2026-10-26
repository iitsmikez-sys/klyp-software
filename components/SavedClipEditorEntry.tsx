"use client";
import {useEffect,useState} from 'react';
import type {SavedClip} from '@/lib/clip-ui';
import {initialSavedEditorState} from '@/lib/editor-compatibility';
import ClipTimelineEditor from './ClipTimelineEditor';
import LegacySavedClipEditor from './LegacySavedClipEditor';
export default function SavedClipEditorEntry({clip}:{clip:SavedClip}) {
 const [mode,setMode]=useState<'loading'|'legacy'|'timeline'>('loading');
 const [hasLegacy,setHasLegacy]=useState(false);
 useEffect(()=>{let raw:string|null=null;try{raw=localStorage.getItem('klyp-editor-'+clip.id);}catch{}const state=initialSavedEditorState(raw);setHasLegacy(state.hasLegacy);setMode(state.mode);},[clip.id]);
 if(mode==='loading')return <p role="status">Loading your saved edits…</p>;
 const banner=hasLegacy?<section aria-label="Saved device edits" className={mode==='timeline'?'editor-device-edits':'flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface px-4 py-2 text-sm text-foreground'}>
  {mode==='legacy'&&<span>Viewing edits saved on this device. Your timeline draft is separate.</span>}
  <button type="button" title={mode==='timeline'?'Your older edits are still saved on this device. The timeline keeps a separate draft.':undefined} className={mode==='timeline'?'':'rounded border border-border px-4 py-2'} onClick={()=>{if(mode==='timeline'&&!window.confirm('Leave the timeline? Unsaved timeline changes will be lost.'))return;setMode(mode==='legacy'?'timeline':'legacy');}}>{mode==='legacy'?'Open timeline editor':'Open original editor'}</button>
 </section>:null;
 return mode==='legacy'?<>{banner}<LegacySavedClipEditor key={clip.id} clip={clip} workspace/></>:<ClipTimelineEditor key={clip.id} clip={clip} compatibilityNotice={banner}/>;
}

