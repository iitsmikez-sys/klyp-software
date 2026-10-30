import assert from 'node:assert/strict';
import test from 'node:test';
import { freshTimelineDraft } from './clip-edit-draft.ts';
import { editorCaptionPlacement } from './editor-text-placement.ts';
import type { SavedClip } from './clip-ui.ts';

const clip={id:'clip',url:'https://example.test',title:'Moment',clip_type:'FUNNY',viral_score:80,caption:null,reason:null,start_seconds:0,end_seconds:18,created_at:'2026-10-22T00:00:00Z',words:[{text:'Wait',start:0,end:300},{text:'France',start:350,end:700}]} as SavedClip;

test('default caption handle sits over the sharp video rather than the blurred bottom band',()=>{
  const draft={...freshTimelineDraft(clip),aspect_ratio:'9:16' as const,caption_cues:null};
  const placement=editorCaptionPlacement(draft,clip,0,{w:852,h:480},null);
  assert.ok(placement.y>.4&&placement.y<.7,`caption y=${placement.y}`);
});

test('handle follows the visible safe position of oversized captions',()=>{
  const draft={...freshTimelineDraft(clip),aspect_ratio:'9:16' as const,caption_cues:null,caption_placement:{x:.5,y:.925,scale:2.5}};
  const placement=editorCaptionPlacement(draft,clip,0,{w:852,h:480},null);
  assert.ok(placement.y<.925,`caption y=${placement.y}`);
});
