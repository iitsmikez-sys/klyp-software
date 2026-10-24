import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {generateAss} from './captions.ts';
import * as preview from './editor-preview.ts';
test('legacy caption color and position remain available',()=>{
 const ass=generateAss([{text:'Hello',start:0,end:1000}],0,1000,'BOLD',{w:1080,h:1920},{color:'YELLOW',position:'CENTER'} as any);
 assert.match(ass,/&H0000FFFF/);assert.match(ass,/,5,10,10,0,1/);
});
test('processing CORS exposes source and layout warning and allows clip ownership header',()=>{
 const code=ts.transpileModule(readFileSync(new URL('./cors.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
 const exports:any={};vm.runInNewContext(code,{exports,require:()=>({}),process:{env:{}}});const headers=exports.corsHeaders();
 assert.match(headers['Access-Control-Allow-Headers'],/x-clip-id/i);assert.match(headers['Access-Control-Expose-Headers'],/X-Klyp-Source/i);assert.match(headers['Access-Control-Expose-Headers'],/X-Klyp-Layout-Warning/i);
});
test('preview origin uses floored archive start and exact freshly rendered start',()=>{
 const origin=(preview as any).previewSourceStart;
 assert.equal(typeof origin,'function');assert.equal(origin(100.75,'archive'),100);assert.equal(origin(100.75,null),100.75);
 const video={currentTime:0};preview.seekEditedVideo(video,[{id:'s',start_seconds:101.5,end_seconds:105}],0,origin(100.75,'archive'));assert.equal(video.currentTime,1.5);
});

import * as compatibility from './editor-compatibility.ts';
import {defaultClipEditDraft,upgradeClipEditDraft} from './clip-edit-draft.ts';
const ownedClip:any={id:'owned',url:'upload:source',title:'Saved',start_seconds:100,end_seconds:110,words:null,hooks:[]};
test('saved device edits select legacy fallback without changing their data',()=>{
 const raw=JSON.stringify({segments:[{start:1,end:2},{start:7,end:9}],media:[{id:'11111111-1111-4111-8111-111111111111',kind:'video',duration:2,after:0}],captionColor:'YELLOW'});
 assert.equal(compatibility.hasLegacyEditorDraft(raw),true);assert.equal(compatibility.hasLegacyEditorDraft(null),false);assert.equal(compatibility.hasLegacyEditorDraft('{broken'),true);
 assert.equal(compatibility.isLegacyEditorExport({segments:[{start:1,end:2}],media:[]}),true);
 assert.equal(compatibility.isLegacyEditorExport({legacy_editor:true,edit_draft:{version:3},segments:[{start:1,end:2}]}),false);
});
test('Free source timeline export uses existing non-editor payload and Original access',()=>{
 const draft={...upgradeClipEditDraft(ownedClip,defaultClipEditDraft(ownedClip)),aspect_ratio:'Original' as const};
 const payload=compatibility.timelineExportPayload(ownedClip,draft,false);
 assert.equal(payload.aspect_ratio,'Original');assert.equal(payload.start_seconds,100);assert.equal(payload.end_seconds,110);assert.equal('edit_draft' in payload,false);assert.equal('segments' in payload,false);
 const edited={...draft,title:'Edited title',hook:'Edited hook',cutaways:[{id:'x'} as any],segments:[{id:'s',start_seconds:101,end_seconds:109}],caption_cues:[{id:'cue',start_ms:101000,end_ms:102000,text:'Edited'}]};
 const snapshot=JSON.stringify(edited),original=compatibility.timelineExportPayload(ownedClip,edited,false);
 assert.equal(original.start_seconds,100);assert.equal(original.end_seconds,110);assert.equal(original.title,'Saved');assert.equal(original.hook,undefined);assert.equal('edit_draft' in original,false);assert.equal(JSON.stringify(edited),snapshot);
 assert.equal(compatibility.timelineExportPayload(ownedClip,draft,true).edit_draft,draft);
});
