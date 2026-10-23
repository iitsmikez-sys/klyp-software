import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { validateEditorExportRequest } from './editor-render.ts';
import { resolveEditorCues, captionAppearance } from './editor-captions.ts';
import { clipSeekRange } from './clip-trim.ts';
import { planClipComposition, validateVerticalLayout } from './vertical-layout.ts';
import { CAPTION_STYLES, EXPORT_FORMATS, FORMAT_DIMENSIONS } from './clips.ts';
import { ClipEditDraftError } from './clip-edit-draft.ts';
const routeCode=ts.transpileModule(readFileSync(new URL('../app/api/clip/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
const clip={id:'owned',url:'https://twitch.tv/videos/123',start_seconds:100,end_seconds:110,words:null,edit_draft:null};
const draft={version:2,start_seconds:101,end_seconds:109,title:'Unsaved',hook:'Hey',hook_style:'IMPACT',caption_style:'BOLD',aspect_ratio:'9:16',words:null,segments:[{id:'a',start_seconds:101,end_seconds:102},{id:'b',start_seconds:108,end_seconds:109}],caption_cues:[{id:'cue',start_ms:101500,end_ms:108500,text:'corrected'}],caption_color:'green',caption_position:'top'};
async function exportRoute(options:{archive?:boolean;missingArchive?:boolean;owned?:boolean;pro?:boolean;body?:Record<string,unknown>;failRender?:boolean;profileLayout?:any}={}){
 const calls:{name:string;args:any[]}[]=[];
 const record=(name:string,...args:any[])=>calls.push({name,args});
 const fs={mkdtemp:async()=>'/temp/editor',readFile:async()=>Buffer.from('mp4'),writeFile:async(...args:any[])=>record('write',...args),rm:async(...args:any[])=>record('rm',...args)};
 const db:any={select:()=>db,eq:(...args:any[])=>{record('eq',...args);return db;},maybeSingle:async()=>({data:options.owned===false?null:clip,error:null})};
 class NextResponse extends Response{static json(body:unknown,init?:ResponseInit){return new NextResponse(JSON.stringify(body),init);}}
 const modules:Record<string,unknown>={
 'next/server':{NextResponse},'fs/promises':fs,os:{tmpdir},path,
 '@/lib/supabase/admin':{createAdminClient:()=>({from:()=>db})},
 '@/lib/editor-render':{validateEditorExportRequest,renderKeptSegments:async(...args:any[])=>{record('render',...args);if(options.failRender)throw new Error('render failed');return {duration:2,hasAudio:true};}},
 '@/lib/clip-edit-draft':{ClipEditDraftError},'@/lib/editor-captions':{resolveEditorCues,captionAppearance},
 '@/lib/bin':{resolveBin:(s:string)=>s,FFMPEG_THREADS:2,runCapture:async()=> '1920,1080',run:async(...args:any[])=>record('encode',...args)},
 '@/lib/captions':{generateAss:()=>{record('legacyCaptions');return 'legacy';},generateTimedCueAss:(...args:any[])=>{record('cues',...args);return 'ass';},generateHookAss:()=> 'hook',toFfmpegPath:(s:string)=>s,HOOK_STYLES:['IMPACT']},
 '@/lib/clips':{CAPTION_STYLES,EXPORT_FORMATS,FORMAT_DIMENSIONS},
 '@/lib/video-cache':{CACHE_DIR:'/cache',isUploadRef:()=>false,resolveSourceSegment:async(...args:any[])=>{record('download',...args);return {path:'/source.mp4',offsetSeconds:100};}},
 '@/lib/job-queue':{runQueued:async(_key:string,fn:()=>Promise<unknown>)=>fn()},'@/lib/watermark':{watermarkFilter:()=> 'watermark'},
 '@/lib/profile-token':{bearerToken:()=> 'token',getProfileFromToken:async()=>({id:'user',tier:options.pro===false?'free':'pro',stripe_subscription_id:options.pro===false?null:'sub',sparks:100,vertical_layout:options.profileLayout??null}),consumeSparksFromToken:async(...args:any[])=>record('charge',...args)},
 '@/lib/vertical-layout':{planClipComposition,validateVerticalLayout},'@/lib/vertical-layout-ffmpeg':{buildVerticalFilterGraph:(plan:any)=>{record('composition',plan);return {filter:'composed',videoLabel:'v'};}},
 '@/lib/clip-archive':{getArchivedClip:async()=>options.archive?{id:'owned',masterPath:'master',status:'stored',originalStartSeconds:100,originalEndSeconds:110}:null,readArchivedObject:async()=>options.missingArchive?null:Buffer.from('master')},
 '@/lib/clip-trim':{clipSeekRange},'@/lib/sparks':{UPSCALE_COST:35},'@/lib/cors':{withCors:(r:Response)=>r,corsPreflight:()=>{}}
 };
 const exports:any={};vm.runInNewContext(routeCode,{exports,require:(name:string)=>{if(!(name in modules))throw new Error(name);return modules[name];},process:{env:{DEPLOYMENT_TARGET:'processing'}},console:{log:()=>{}},Buffer,Response});
 const body=options.body??{clip_id:'owned',url:'https://twitch.tv/videos/forged',edit_draft:draft,caption_cues:[{text:'forged'}]};
 const response:Response=await exports.POST({json:async()=>body});return {response,calls};
}
test('source fallback uses owned URL/envelope, server-resolved cues and zero-based final cut without charge',async()=>{
 const {response,calls}=await exportRoute();assert.equal(response.status,200);
 assert.deepEqual(calls.find(c=>c.name==='download')?.args,[clip.url,101,109]);
 assert.ok(calls.some(c=>c.name==='eq'&&c.args[0]==='user_id'&&c.args[1]==='user'));
 assert.deepEqual(calls.find(c=>c.name==='render')?.args.slice(0,3),['/source.mp4',100,draft.segments]);
 const cues=calls.find(c=>c.name==='cues')!.args;assert.deepEqual(cues[0].map((c:any)=>[c.start_ms,c.end_ms,c.text]),[[500,1000,'corrected'],[1000,1500,'corrected']]);
 assert.equal(cues[2].color,'#00E5A0');assert.ok(cues[4].h>0);
 const args=calls.find(c=>c.name==='encode')!.args[1];assert.deepEqual(Array.from(args.slice(0,6)),['-ss','0','-t','2','-i',path.join('/temp/editor','kept.mp4')]);
 assert.equal(calls.filter(c=>c.name==='charge').length,0);assert.ok(calls.some(c=>c.name==='rm'&&c.args[0]==='/temp/editor'));
});
test('archive renders absolute source spans relative to original master start; missing object falls back once',async()=>{
 for(const missingArchive of [false,true]){const {response,calls}=await exportRoute({archive:true,missingArchive});assert.equal(response.status,200);assert.equal(calls.filter(c=>c.name==='download').length,missingArchive?1:0);assert.equal(calls.find(c=>c.name==='render')?.args[1],100);}
});
test('ownership, subscription and forged bounds reject before download or rendering',async()=>{
 for(const options of [{owned:false},{pro:false},{body:{clip_id:'owned',edit_draft:{...draft,segments:[{id:'bad',start_seconds:1,end_seconds:2}]}}}]){const {response,calls}=await exportRoute(options);assert.ok([400,403,404].includes(response.status));assert.equal(calls.filter(c=>['download','render','encode','charge'].includes(c.name)).length,0);}
});
test('render failure cleans intermediate directory and does not charge; upscale charges only after success',async()=>{
 const failed=await exportRoute({failRender:true});assert.equal(failed.response.status,500);assert.ok(failed.calls.some(c=>c.name==='rm'));assert.ok(!failed.calls.some(c=>c.name==='charge'));
 const success=await exportRoute({body:{clip_id:'owned',edit_draft:draft,upscale:true}});assert.equal(success.response.status,200);assert.deepEqual(success.calls.find(c=>c.name==='charge')?.args,['token',35]);
});
test('legacy requests keep their single-range word-caption path',async()=>{
 const {response,calls}=await exportRoute({body:{url:clip.url,start_seconds:101,end_seconds:102,style:'BOLD',words:[{text:'legacy',start:101000,end:102000}]}});assert.equal(response.status,200);assert.ok(calls.some(c=>c.name==='legacyCaptions'));assert.ok(!calls.some(c=>c.name==='render'));const args=calls.find(c=>c.name==='encode')!.args[1];assert.deepEqual(Array.from(args.slice(0,4)),['-ss','1','-t','1']);
});


test('raw V2 exports retain cuts without captions and preserve Pro enforcement',async()=>{
 const {response,calls}=await exportRoute({body:{clip_id:'owned',edit_draft:draft,raw:true}});assert.equal(response.status,200);assert.ok(calls.some(c=>c.name==='render'));assert.ok(!calls.some(c=>c.name==='cues'));const args=calls.find(c=>c.name==='encode')!.args[1];assert.ok(!args.includes('-filter_complex')&&!args.includes('-vf'));
});

const accountLayout = {version:1,gameplay:{x:0,y:0,w:1,h:1},facecam:{x:0,y:0,w:.2,h:.2}};
test('explicit null disables account layout while omitted draft layout inherits',async()=>{
 for(const explicit of [true,false]) {
  const {response,calls}=await exportRoute({profileLayout:accountLayout,body:{clip_id:'owned',edit_draft:{...draft,...(explicit?{vertical_layout:null}:{})}}});
  assert.equal(response.status,200);
  assert.equal(calls.find(c=>c.name==='composition')?.args[0].mode,explicit?'full_frame':'composed');
 }
});
test('square export uses the shared composition with a centered landscape crop',async()=>{
 const {response,calls}=await exportRoute({body:{clip_id:'owned',edit_draft:{...draft,aspect_ratio:'1:1'}}});
 assert.equal(response.status,200);
 assert.deepEqual(calls.find(c=>c.name==='composition')?.args[0].panels[0].source,{x:420,y:0,w:1080,h:1080});
});
