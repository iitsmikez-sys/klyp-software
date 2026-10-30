import {isLegacyEditorExport} from './editor-compatibility.ts';
import * as legacySegments from './edit-segments.ts';
import * as legacyMedia from './editor-media.ts';
import {buildEditorMediaFilter} from './editor-media-render.ts';
import {parseEditedWords} from './editor-captions.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { validateEditorExportRequest } from './editor-render.ts';
import { resolveEditorCues, captionAppearance, parseCaptionOptions } from './editor-captions.ts';
import { clipSeekRange, archivedClipTiming } from './clip-trim.ts';
import { planClipComposition, validateVerticalLayout } from './vertical-layout.ts';
import { CAPTION_STYLES, EXPORT_FORMATS, FORMAT_DIMENSIONS, resolveExportFormat } from './clips.ts';
import { ClipEditDraftError, freshTimelineDraft } from './clip-edit-draft.ts';
import { EditorAssetError } from './editor-assets.ts';
import { resolveCutawaySpans } from './editor-timeline.ts';
import { layoutForFocus, resolveFocusSpans, splitCuesForFocus } from './editor-focus.ts';
import * as cutawayRenderer from './editor-cutaway-render.ts';
const legacyCode=ts.transpileModule(readFileSync(new URL('./legacy-clip-export-route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
const routeCode=ts.transpileModule(readFileSync(new URL('../app/api/clip/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
const clip={id:'owned',url:'https://twitch.tv/videos/123',title:'Original moment',start_seconds:100,end_seconds:110,words:null,edit_draft:null};
const draft={version:2,start_seconds:101,end_seconds:109,title:'Unsaved',hook:'Hey',hook_style:'IMPACT',caption_style:'BOLD',aspect_ratio:'9:16',words:null,segments:[{id:'a',start_seconds:101,end_seconds:102},{id:'b',start_seconds:108,end_seconds:109}],caption_cues:[{id:'cue',start_ms:101500,end_ms:108500,text:'corrected'}],caption_color:'green',caption_position:'top'};
async function exportRoute(options:{userId?:string;archive?:boolean;archiveStart?:number;missingArchive?:boolean;coldCache?:boolean;owned?:boolean;exactMoment?:boolean;pro?:boolean;body?:Record<string,unknown>;failRender?:boolean;profileLayout?:any;assetError?:EditorAssetError;failAssetDownload?:boolean;assetKind?:'photo'|'video'}={}){
 const calls:{name:string;args:any[]}[]=[];
 const record=(name:string,...args:any[])=>calls.push({name,args});
 let cacheExists=!options.coldCache;
 const fs={mkdtemp:async()=>'/temp/editor',readFile:async()=>Buffer.from('mp4'),mkdir:async(location:string)=>{record('mkdir',location);if(path.normalize(location)===path.normalize('/cache'))cacheExists=true;},writeFile:async(location:string,...args:any[])=>{if(path.dirname(location)===path.normalize('/cache')&&!cacheExists)throw new Error('ENOENT: cold cache directory');record('write',location,...args);},rm:async(...args:any[])=>record('rm',...args)};
 const db:any={select:()=>db,eq:(...args:any[])=>{record('eq',...args);return db;},maybeSingle:async()=>({data:options.owned===false?null:clip,error:null})};
 class NextResponse extends Response{static json(body:unknown,init?:ResponseInit){return new NextResponse(JSON.stringify(body),init);}}
 const modules:Record<string,unknown>={
 'next/server':{NextResponse},'fs/promises':fs,os:{tmpdir},path,
 '@/lib/supabase/admin':{createAdminClient:()=>({from:()=>db})},
 '@/lib/editor-render':{validateEditorExportRequest,renderKeptSegments:async(...args:any[])=>{record('render',...args);if(options.failRender)throw new Error('render failed');return {duration:2,hasAudio:true};}},
 '@/lib/editor-timeline':{resolveCutawaySpans},
 '@/lib/editor-focus':{layoutForFocus,resolveFocusSpans,splitCuesForFocus},
 '@/lib/editor-assets':{EditorAssetError,assertOwnedDraftAssets:async(...args:any[])=>{record('verifyAssets',...args);if(options.assetError)throw options.assetError;}},
 '@/lib/editor-cutaway-render':{...cutawayRenderer,loadEditorCutawayAssets:async(...args:any[])=>{record('loadAssets',...args);if(options.failAssetDownload)throw new EditorAssetError('Media is missing.',404);return [{id:'asset',localPath:'/trusted/asset.png',kind:options.assetKind??'photo',mime_type:options.assetKind==='video'?'video/mp4':'image/png',width:128,height:64,duration_ms:options.assetKind==='video'?3000:null}];}},
 '@/lib/clip-edit-draft':{ClipEditDraftError},'@/lib/editor-captions':{resolveEditorCues,captionAppearance,parseCaptionOptions},
 '@/lib/bin':{resolveBin:(s:string)=>s,FFMPEG_THREADS:2,runCapture:async(_bin:string,args:string[])=>args.includes('a:0')?'{"streams":[{"codec_type":"audio"}]}':'1920,1080',run:async(...args:any[])=>record('encode',...args)},
 '@/lib/captions':{generateAss:(...args:any[])=>{record('legacyCaptions',...args);return 'legacy';},generateTimedCueAss:(...args:any[])=>{record('cues',...args);return 'ass';},generateHookAss:()=> 'hook',toFfmpegPath:(s:string)=>s,HOOK_STYLES:['IMPACT']},
 '@/lib/clips':{CAPTION_STYLES,EXPORT_FORMATS,FORMAT_DIMENSIONS,resolveExportFormat},
 '@/lib/video-cache':{CACHE_DIR:'/cache',isUploadRef:()=>false,resolveSourceSegment:async(...args:any[])=>{record('download',...args);return {path:'/source.mp4',offsetSeconds:100};}},
 '@/lib/job-queue':{runQueued:async(_key:string,fn:()=>Promise<unknown>)=>fn()},'@/lib/watermark':{watermarkFilter:()=> 'watermark'},
 '@/lib/profile-token':{bearerToken:()=> 'token',getProfileFromToken:async()=>({id:options.userId??'user',tier:options.pro===false?'free':'pro',stripe_subscription_id:options.pro===false?null:'sub',sparks:100,vertical_layout:options.profileLayout??null}),consumeSparksFromToken:async(...args:any[])=>record('charge',...args)},
 '@/lib/vertical-layout':{planClipComposition,validateVerticalLayout},'@/lib/vertical-layout-ffmpeg':{buildVerticalFilterGraph:(plan:any)=>{record('composition',plan);return {filter:'composed',videoLabel:'v'};},buildTimedVerticalFilterGraph:(spans:any,overlays:any)=>{record('timedComposition',spans,overlays);return {filter:'timed',videoLabel:'v'};}},
 '@/lib/clip-archive':{getArchivedClip:async()=>options.archive?{id:'owned',masterPath:'master',status:'stored',originalStartSeconds:options.archiveStart??100,originalEndSeconds:110}:null,readArchivedObject:async()=>options.missingArchive?null:Buffer.from('master')},
 '@/lib/clip-trim':{clipSeekRange,archivedClipTiming},'@/lib/sparks':{UPSCALE_COST:35},'@/lib/cors':{withCors:(r:Response)=>r,corsPreflight:()=>{}},
 '@/lib/clip-access':{canProcessClip:async()=>true,canDownloadRawMoment:async(...args:any[])=>{record('exactRawAccess',...args);return options.exactMoment!==false;},acquireUserProcessingSlot:()=>()=>record('releaseSlot')}
 };
 const legacyExports:any={};
 Object.assign(modules,{'@/lib/editor-compatibility':{isLegacyEditorExport},'@/lib/edit-segments':legacySegments,'@/lib/editor-media':legacyMedia,'@/lib/editor-media-render':{buildEditorMediaFilter},'@/lib/editor-captions':{resolveEditorCues,captionAppearance,parseCaptionOptions,parseEditedWords}});
 vm.runInNewContext(legacyCode,{exports:legacyExports,require:(name:string)=>modules[name],process:{env:{DEPLOYMENT_TARGET:'processing'}},console:{log:()=>{}},Buffer,Response,Error,RangeError});
 modules['@/lib/legacy-clip-export-route']={handleLegacyClipExport:legacyExports.handleLegacyClipExport};
 const exports:any={};vm.runInNewContext(routeCode,{exports,require:(name:string)=>{if(!(name in modules))throw new Error(name);return modules[name];},process:{env:{DEPLOYMENT_TARGET:'processing'}},console:{log:()=>{}},Buffer,Response,Error,RangeError});
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
test('archived master exports after a restart with no local cache directory',async()=>{
 for(const body of [
  {clip_id:'owned',url:clip.url,start_seconds:100,end_seconds:110,aspect_ratio:'9:16'},
  {legacy_editor:true,clip_id:'owned',url:clip.url,start_seconds:100,end_seconds:110,segments:[{start:0,end:10}]},
 ]) {
  const {response,calls}=await exportRoute({archive:true,coldCache:true,body});
  assert.equal(response.status,200,await response.clone().text());
  assert.ok(calls.some(c=>c.name==='write'&&String(c.args[0]).includes('master-owned.mp4')));
  assert.ok(!calls.some(c=>c.name==='download'));
 }
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


test('raw request with an edit draft still downloads the untouched detected moment',async()=>{
 const {response,calls}=await exportRoute({body:{clip_id:'owned',edit_draft:draft,raw:true}});assert.equal(response.status,200);assert.ok(!calls.some(c=>c.name==='render'));assert.ok(!calls.some(c=>c.name==='cues'));const args=calls.find(c=>c.name==='encode')!.args[1];assert.ok(!args.includes('-filter_complex')&&!args.includes('-vf'));
});

test('Free raw download uses owned original moment and ignores saved editing effects without a Sparks charge',async()=>{
 const {response,calls}=await exportRoute({pro:false,archive:true,body:{clip_id:'owned',url:'https://twitch.tv/videos/forged',start_seconds:101,end_seconds:102,raw:true,edit_draft:draft,aspect_ratio:'9:16',hook:'forged',style:'BOLD'}});
 assert.equal(response.status,200,await response.clone().text());
 assert.equal(calls.filter(c=>c.name==='download').length,0);
 assert.ok(!calls.some(c=>['render','cues','composition','charge','verifyAssets'].includes(c.name)));
 const args=Array.from(calls.find(c=>c.name==='encode')!.args[1]) as string[];
 assert.deepEqual(args.slice(0,6),['-ss','0','-t','10','-i',path.join('/cache','master-owned.mp4')]);
 assert.ok(!args.includes('-vf')&&!args.includes('-filter_complex'));
 assert.ok(!args.some(arg=>String(arg).includes('watermark')||String(arg).includes('subtitles')||String(arg).includes('crop=')));
 assert.deepEqual(args.slice(args.indexOf('-c:a'),args.indexOf('-c:a')+2),['-c:a','aac']);
 assert.equal((response.headers.get('Content-Disposition')??'').includes('Unsaved'),false);
});

test('fresh timeline export has no captions, hook or forced crop',async()=>{
 const clean=freshTimelineDraft(clip as any);
 const {response,calls}=await exportRoute({body:{clip_id:'owned',edit_draft:clean}});
 assert.equal(response.status,200,await response.clone().text());
 assert.ok(!calls.some(c=>c.name==='cues'));
 const args=Array.from(calls.find(c=>c.name==='encode')!.args[1]) as string[];
 assert.equal(args[args.indexOf('-vf')+1],'null');
});

test('raw download rejects a missing saved clip and a forged unsaved moment before source work',async()=>{
 for(const options of [{owned:false,body:{clip_id:'owned',raw:true}},{exactMoment:false,body:{url:clip.url,start_seconds:101,end_seconds:109,raw:true}}]){
  const {response,calls}=await exportRoute(options);
  assert.ok([403,404].includes(response.status));
  assert.ok(!calls.some(c=>['download','encode','charge'].includes(c.name)));
 }
});

test('P1 voice polish reaches normal export while raw export stays untouched',async()=>{
 const edited={...draft,version:3,cutaways:[],audio_polish:'voice',caption_font:'mono'};
 const normal=await exportRoute({body:{clip_id:'owned',edit_draft:edited}});
 assert.equal(normal.response.status,200);
 assert.equal(normal.calls.find(c=>c.name==='render')?.args[4],'voice');
 assert.equal(normal.calls.find(c=>c.name==='cues')?.args[5],'mono');
 const raw=await exportRoute({body:{clip_id:'owned',edit_draft:edited,raw:true}});
 assert.equal(raw.response.status,200);
 assert.ok(!raw.calls.some(c=>c.name==='render'));
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
test('saved focus switches drive timed export and split captions at the switch',async()=>{
 const layout={version:1,gameplay:{x:.25,y:0,w:.75,h:1},facecam:{x:0,y:0,w:.25,h:1},arrangement:'gameplay_top'};
 const edited={...draft,version:3,cutaways:[],focus_events:[{id:'reaction',source_ms:101750,mode:'reaction'},{id:'gameplay',source_ms:108250,mode:'gameplay'}]};
 const {response,calls}=await exportRoute({profileLayout:layout,body:{clip_id:'owned',edit_draft:edited}});
 assert.equal(response.status,200);
 const timed=calls.find(c=>c.name==='timedComposition');assert.ok(timed);
 assert.deepEqual(timed.args[0].map((s:any)=>[s.start_ms,s.end_ms]),[[0,750],[750,1250],[1250,2000]]);
 const captions=calls.find(c=>c.name==='cues')!.args;
 assert.deepEqual(captions[0].map((c:any)=>[c.start_ms,c.end_ms]),[[500,750],[750,1000],[1000,1250],[1250,1500]]);
 assert.equal(typeof captions[4],'function');
 const args=calls.find(c=>c.name==='encode')!.args[1];assert.ok(args.includes('0:a?'));
});
test('focus switches require a facecam for vertical export and leave square framing unchanged',async()=>{
 const edited={...draft,version:3,cutaways:[],focus_events:[{id:'reaction',source_ms:101500,mode:'reaction'}]};
 const missing=await exportRoute({body:{clip_id:'owned',edit_draft:edited}});
 assert.equal(missing.response.status,400);assert.match((await missing.response.json()).error,/facecam/i);
 assert.ok(!missing.calls.some(c=>c.name==='download'));
 const square=await exportRoute({body:{clip_id:'owned',edit_draft:{...edited,aspect_ratio:'1:1'}}});
 assert.equal(square.response.status,200);assert.ok(!square.calls.some(c=>c.name==='timedComposition'));
});
test('focus composition stays beneath imported cutaways and keeps source audio',async()=>{
 const layout={version:1,gameplay:{x:.25,y:0,w:.75,h:1},facecam:{x:0,y:0,w:.25,h:1}};
 const edited={...imported,focus_events:[{id:'reaction',source_ms:101500,mode:'reaction'}]};
 const {response,calls}=await exportRoute({profileLayout:layout,body:{clip_id:'owned',edit_draft:edited}});
 assert.equal(response.status,200);assert.ok(calls.some(c=>c.name==='timedComposition'));
 const args=Array.from(calls.find(c=>c.name==='encode')!.args[1]) as string[];
 const graph=args[args.indexOf('-filter_complex')+1];assert.ok(graph.indexOf('timed')<graph.indexOf('overlay='));assert.ok(args.includes('0:a?'));
});

const imported={...draft,version:3,cutaways:[{id:'visual',asset_id:'asset',source_start_ms:101000,source_end_ms:101500,asset_in_ms:0,fit:'cover',focal_point:{x:0.5,y:0.5}}]};
test('normal export composites verified imports after framing and before captions while mapping source audio',async()=>{
 const {response,calls}=await exportRoute({body:{clip_id:'owned',edit_draft:imported,assets:[{localPath:'https://evil.invalid/media'}]}});
 assert.equal(response.status,200);
 assert.deepEqual(calls.find(c=>c.name==='verifyAssets')?.args.slice(0,2),['user','owned']);
 assert.deepEqual(calls.find(c=>c.name==='loadAssets')?.args.slice(0,2),['user','owned']);
 const args=Array.from(calls.find(c=>c.name==='encode')!.args[1]) as string[];
 assert.ok(args.includes('/trusted/asset.png'));assert.ok(!args.some(a=>a.includes('evil.invalid')));
 const filter=args[args.indexOf('-filter_complex')+1];
 assert.ok(filter.indexOf('composed')<filter.indexOf('overlay='));
 assert.ok(filter.indexOf('overlay=')<filter.indexOf('subtitles='));
 assert.ok(args.includes('0:a?'));assert.ok(!args.includes('1:a?'));
 assert.ok(calls.some(c=>c.name==='rm'&&c.args[0]==='/temp/editor'));
});
test('insert-only export verifies and loads owned media before rendering',async()=>{
 const insertOnly={...draft,version:3,cutaways:[],inserts:[{id:'insert',asset_id:'asset',after_segment_id:'a',duration_ms:1000,asset_in_ms:0,muted:false}]};
 const {response,calls}=await exportRoute({body:{clip_id:'owned',edit_draft:insertOnly}});
 assert.equal(response.status,200);
 assert.ok(calls.some(c=>c.name==='verifyAssets'));
 assert.ok(calls.some(c=>c.name==='loadAssets'));
 const render=calls.find(c=>c.name==='render')!;
 assert.equal(render.args[5].items[0].asset_id,'asset');
 assert.equal(render.args[5].assets[0].localPath,'/trusted/asset.png');
});
test('unmuted overlay video mixes its own audio while muted overlays preserve source audio',async()=>{
 const overlay={...imported,cutaways:[{...imported.cutaways[0],placement:'overlay',rect:{x:.2,y:.2,w:.4,h:.4},muted:false}]};
 const audible=await exportRoute({assetKind:'video',body:{clip_id:'owned',edit_draft:overlay}});
 assert.equal(audible.response.status,200);
 const args=audible.calls.find(c=>c.name==='encode')!.args[1] as string[];
 assert.match(args[args.indexOf('-filter_complex')+1],/amix=inputs=2/);
 assert.ok(args.includes('[exportaudio]'));
 const silent=await exportRoute({assetKind:'video',body:{clip_id:'owned',edit_draft:{...overlay,cutaways:[{...overlay.cutaways[0],muted:true}]}}});
 assert.equal(silent.response.status,200);
 const silentArgs=silent.calls.find(c=>c.name==='encode')!.args[1] as string[];
 assert.ok(silentArgs.includes('0:a?'));
});
test('foreign, missing, and unavailable media fail with useful status before source work',async()=>{
 for(const status of [404,503]){
  const {response,calls}=await exportRoute({assetError:new EditorAssetError('Media asset not found or unavailable.',status),body:{clip_id:'owned',edit_draft:imported}});
  assert.equal(response.status,status);assert.ok(!calls.some(c=>['download','render','encode'].includes(c.name)));
 }
 const failed=await exportRoute({failAssetDownload:true,body:{clip_id:'owned',edit_draft:imported}});
 assert.equal(failed.response.status,404);assert.ok(!failed.calls.some(c=>c.name==='encode'));assert.ok(failed.calls.some(c=>c.name==='rm'));
});
test('raw export ignores cutaways and remains the original detected footage',async()=>{
 const {response,calls}=await exportRoute({body:{clip_id:'owned',edit_draft:imported,raw:true}});
 assert.equal(response.status,200);
 assert.ok(!calls.some(c=>['render','loadAssets','verifyAssets'].includes(c.name)));
});


test('fractional archived masters retain their whole-second source offset',async()=>{
 const {response,calls}=await exportRoute({archive:true,archiveStart:100.75});assert.equal(response.status,200);assert.equal(calls.find(c=>c.name==='render')?.args[1],100);
});
test('Free Original exports preserve native framing and keep watermark',async()=>{
 const {response,calls}=await exportRoute({pro:false,body:{url:clip.url,start_seconds:101,end_seconds:102,aspect_ratio:'Original'}});assert.equal(response.status,200);const args=calls.find(c=>c.name==='encode')!.args[1];assert.ok(!calls.some(c=>c.name==='composition'));assert.match(args[args.indexOf('-vf')+1],/watermark/);assert.doesNotMatch(args[args.indexOf('-vf')+1],/crop=/);
});

test('existing relative cuts and sequential photo imports still render through owned legacy path',async()=>{
 const user='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222';
 const {response,calls}=await exportRoute({userId:user,archive:true,body:{legacy_editor:true,clip_id:id,url:clip.url,start_seconds:100,end_seconds:110,segments:[{start:1,end:2},{start:7,end:9}],media:[{id:'33333333-3333-4333-8333-333333333333',kind:'image',after:0,duration:.5}]}});
 assert.equal(response.status,200);const args=calls.find(c=>c.name==='encode')!.args[1];const graph=args[args.indexOf('-filter_complex')+1];assert.match(graph,/trim=start=1:end=2/);assert.match(graph,/trim=start=7:end=9/);assert.match(graph,/concat=n=3/);assert.ok(args.some((arg:string)=>arg.endsWith('.jpg')));assert.ok(!calls.some(c=>c.name==='render'));
});
