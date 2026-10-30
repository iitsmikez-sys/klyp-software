import test from 'node:test';
import assert from 'node:assert/strict';
import { createCutawayAtPlayhead, createOverlayAtPlayhead, createTimelineInsert, updateCutawayInterval, cutawayDrawRect, uploadEditorFile } from './editor-media-client.ts';

test('new overlay is a movable foreground layer while old cutaways remain replacement shots',()=>{
 const overlay=createOverlayAtPlayhead(draft(),asset,2,'overlay');
 assert.equal(overlay.placement,'overlay');assert.deepEqual(overlay.rect,{x:.3,y:.3,w:.4,h:.4});
 assert.equal(createCutawayAtPlayhead(draft(),asset,2,'old').placement,undefined);
 const saved=validateClipEditDraft({...draft(),cutaways:[overlay]},clip);
 assert.equal(saved.version,3);
 assert.deepEqual(saved.cutaways[0].rect,overlay.rect);
});
test('overlay timing after an inserted section maps back to its source anchor',()=>{
 const base=draft();const split={...base,segments:[{id:'a',start_seconds:100,end_seconds:110},{id:'b',start_seconds:110,end_seconds:120}],inserts:[{id:'media',asset_id:'video',after_segment_id:'a',duration_ms:3000,asset_in_ms:0,muted:false}]};
 const overlay=createOverlayAtPlayhead(split,asset,14,'overlay');
 const shifted=updateCutawayInterval({...split,cutaways:[overlay]},overlay,asset,14,16,0);
 assert.equal(shifted.source_start_ms,111000);assert.equal(shifted.source_end_ms,113000);
});

test('an imported video inserted after a split section plays its own audio by default',()=>{
 const value=createTimelineInsert(draft(),{...asset,id:'video',kind:'video',duration_ms:5000},'segment-1','new');
 assert.equal(value.after_segment_id,'segment-1');assert.equal(value.duration_ms,5000);assert.equal(value.muted,false);
 assert.throws(()=>createTimelineInsert(draft(),asset,'missing','new'));
});
import { defaultClipEditDraft, upgradeClipEditDraft, validateClipEditDraft } from './clip-edit-draft.ts';
import { resolveCutawaySpans } from './editor-timeline.ts';
import { apply, reset, undo } from './editor-history.ts';
import type { SavedClip } from './clip-ui.ts';
import type { EditorAsset } from './editor-assets.ts';
const clip = {id:'clip', title:'Test', start_seconds:100, end_seconds:120, words:null} as SavedClip;
const draft = () => upgradeClipEditDraft(clip, defaultClipEditDraft(clip));
const asset = {id:'photo', status:'verified', kind:'photo', duration_ms:null} as EditorAsset;

test('photo insertion anchors three output seconds at playhead; save/reload and remove/undo retain it', () => {
 const d=draft(); const c=createCutawayAtPlayhead(d,asset,2,'cut');
 assert.deepEqual(c,{id:'cut',asset_id:'photo',source_start_ms:102000,source_end_ms:105000,asset_in_ms:0,fit:'cover',focal_point:{x:.5,y:.5}});
 const saved=validateClipEditDraft(JSON.parse(JSON.stringify({...d,cutaways:[c]})),clip);
 assert.equal(saved.version,3);
 const h=apply(reset(saved),{...saved,version:3 as const,cutaways:[]});
 assert.deepEqual(undo(h).present,saved);
});
test('video insertion respects usable source duration and clip remainder across deleted footage', () => {
 const d={...draft(),segments:[{id:'a',start_seconds:100,end_seconds:104},{id:'b',start_seconds:110,end_seconds:120}]};
 const c=createCutawayAtPlayhead(d,{...asset,id:'video',kind:'video',duration_ms:9000},2,'cut');
 assert.equal(c.source_end_ms,111000); // Gap consumes imported frames, just like export.
 assert.deepEqual(resolveCutawaySpans({...d,cutaways:[c]}).map(s=>[s.start_ms,s.end_ms]),[[2000,4000],[4000,5000]]);
 assert.equal(createCutawayAtPlayhead(d,asset,13,'end').source_end_ms,120000);
 assert.throws(()=>createCutawayAtPlayhead(d,asset,14,'end'),/end|playhead/i);
});
test('interval editing maps the end boundary to the preceding segment and rejects overlap/invalid duration', () => {
 const d={...draft(),segments:[{id:'a',start_seconds:100,end_seconds:104},{id:'b',start_seconds:110,end_seconds:120}]};
 const c=createCutawayAtPlayhead(d,asset,0,'cut');
 const moved=updateCutawayInterval({...d,cutaways:[c]},c,asset,2,4,0);
 assert.equal(moved.source_end_ms,104000);
 assert.equal(moved.source_start_ms,102000);
 assert.throws(()=>updateCutawayInterval(d,c,{...asset,kind:'video',duration_ms:1000},2,4,0),/duration|beyond/i);
 assert.throws(()=>createCutawayAtPlayhead({...d,cutaways:[c]},asset,1,'other'),/overlap/i);
 assert.throws(()=>createCutawayAtPlayhead(d,{...asset,status:'pending'},0,'cut'),/verified/i);
});
test('cutaway geometry replaces the entire frame with correct focal cover/contain using display dimensions', () => {
 assert.deepEqual(cutawayDrawRect(1920,1080,540,960,'cover',{x:1,y:0}),{x:-1168,y:0,w:1708,h:960});
 assert.deepEqual(cutawayDrawRect(1920,1080,540,960,'contain',{x:.5,y:1}),{x:0,y:658,w:540,h:302});
 assert.deepEqual(cutawayDrawRect(1440,1080,540,960,'contain',{x:.5,y:.5}),{x:0,y:278,w:540,h:404});
});
test('upload sends only metadata to app, bytes directly to storage, then verifies before returning', async () => {
 const phases:string[]=[], calls:string[]=[]; const file=new File(['photo'],'image.png',{type:'image/png'});
 const result=await uploadEditorFile('clip',file,'photo',p=>phases.push(p),{
  request:async(url,init)=>{calls.push(String(url));assert.deepEqual(JSON.parse(String(init?.body)),{file_name:'image.png',size_bytes:5,mime_type:'image/png'});return Response.json({asset:{...asset,status:'pending'},upload:{path:'private/photo',token:'signed',signedUrl:'unused'}});},
  upload:async(path,token,body,mime)=>{assert.equal(path,'private/photo');assert.equal(token,'signed');assert.equal(body,file);assert.equal(mime,'image/png');calls.push('storage');},
  finalize:async(url)=>{calls.push(String(url));return Response.json({asset});},
 });
 assert.equal(result.status,'verified');assert.deepEqual(phases,['preparing','uploading','verifying']);
 assert.deepEqual(calls,['/api/clips/clip/media','storage','/api/clips/clip/media/photo/finalize']);
});
test('invalid selection/oversize fails before networking and failed verification never inserts', async () => {
 const deps={request:async()=>{throw Error('must not call');},upload:async()=>{},finalize:async()=>Response.json({asset:{...asset,status:'failed'}})};
 await assert.rejects(uploadEditorFile('clip',new File(['bad'],'bad.exe',{type:'image/png'}),'photo',()=>{},deps),/format|file|type/i);
 await assert.rejects(uploadEditorFile('clip',new File([new Uint8Array(10*1024*1024+1)],'big.png',{type:'image/png'}),'photo',()=>{},deps),/10 MB/);
 await assert.rejects(uploadEditorFile('clip',new File(['bad'],'photo.png',{type:'image/png'}),'video',()=>{},deps),/video/i);
 await assert.rejects(uploadEditorFile('clip',new File(['ok'],'photo.png',{type:'image/png'}),'photo',()=>{},{...deps,request:async()=>Response.json({asset,upload:{path:'p',token:'t'}})}),/verified|verification/i);
});
