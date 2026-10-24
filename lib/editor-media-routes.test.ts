import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { EditorAssetError } from './editor-assets.ts';
import { authorizeClipDraftWrite } from './clip-edit-auth.ts';
import { ClipEditDraftError, validateClipEditDraft } from './clip-edit-draft.ts';
const clipId='11111111-1111-4111-8111-111111111111', assetId='22222222-2222-4222-8222-222222222222';
const clip={id:clipId,user_id:'user',start_seconds:0,end_seconds:10,words:null};
const draft={version:3,start_seconds:0,end_seconds:10,title:'Clip',hook:'',hook_style:'IMPACT',caption_style:'BOLD',aspect_ratio:'9:16',words:null,segments:[{id:'s',start_seconds:0,end_seconds:10}],caption_cues:null,caption_color:'white',caption_position:'bottom',cutaways:[{id:'c',asset_id:assetId,asset_in_ms:0,source_start_ms:0,source_end_ms:1000,fit:'cover',focal_point:{x:0.5,y:0.5}}]};
function route(file:string, options:{signedOut?:boolean;pro?:boolean;assetError?:EditorAssetError;target?:string}={}) {
 const calls:{name:string;args:any[]}[]=[];
 const record=(name:string,...args:any[])=>calls.push({name,args});
 const invoke=(name:string,result:unknown)=>async(...args:any[])=>{record(name,...args);if(options.assetError)throw options.assetError;return result;};
 const db:any={select:()=>db,eq:()=>db,maybeSingle:async()=>({data:clip,error:null}),update:(data:any)=>{record('save',data);return db;},single:async()=>({data:{edit_draft:draft},error:null})};
 class NextResponse extends Response {static json(body:unknown,init?:ResponseInit){return new NextResponse(JSON.stringify(body),init);}}
 const modules:Record<string,any>={
  'next/server':{NextResponse},
  '@/lib/supabase/server':{createClient:async()=>({auth:{getUser:async()=>({data:{user:options.signedOut?null:{id:'user'}}})}})},
  '@/lib/supabase/admin':{createAdminClient:()=>({from:()=>db})},
  '@/lib/profile':{getProfile:async()=>({tier:options.pro===false?'free':'pro',stripe_subscription_id:options.pro===false?null:'sub'})},
  '@/lib/clip-edit-auth':{authorizeClipDraftWrite},
  '@/lib/clip-edit-draft':{ClipEditDraftError,validateClipEditDraft},
  '@/lib/editor-assets':{EditorAssetError,createEditorUpload:invoke('create',{asset:{id:assetId},upload:{token:'signed'}}),listEditorAssets:invoke('list',[]),previewEditorAsset:invoke('preview',{preview_url:'signed'}),finalizeEditorUpload:invoke('finalize',{id:assetId,status:'verified'}),assertOwnedDraftAssets:invoke('validate',undefined)},
  '@/lib/profile-token':{bearerToken:(req:Request)=>req.headers.get('authorization')?.replace('Bearer ','')??null,getProfileFromToken:async()=>options.signedOut?null:{id:'user',tier:options.pro===false?'free':'pro',stripe_subscription_id:options.pro===false?null:'sub'}},
  '@/lib/cors':{corsPreflight:()=>new Response(null,{status:204}),withCors:(res:Response)=>{res.headers.set('Access-Control-Allow-Origin','*');return res;}},
 };
 const code=ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const sandbox={exports:{} as any,require:(name:string)=>{if(!(name in modules))throw new Error(`Unexpected module ${name}`);return modules[name];},process:{env:{DEPLOYMENT_TARGET:options.target??'processing'}},console,Response};
 vm.runInNewContext(code,sandbox);
 return {handlers:sandbox.exports,calls};
}
const context={params:{id:clipId,assetId}};
const body=()=>new Request('https://test/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({file_name:'photo.png',size_bytes:100,mime_type:'image/png'})});
test('initiation uses signed-in cookie identity and only returns a direct storage upload',async()=>{
 const r=route('../app/api/clips/[id]/media/route.ts');
 const response=await r.handlers.POST(body(),context); assert.equal(response.status,201);
 assert.deepEqual(r.calls,[{name:'create',args:['user',clipId,'photo.png',100,'image/png']}]);
 const denied=route('../app/api/clips/[id]/media/route.ts',{signedOut:true});
 assert.equal((await denied.handlers.POST(body(),context)).status,401); assert.equal(denied.calls.length,0);
});
test('list and preview bind asset requests to cookie owner and clip; preserve unavailable errors',async()=>{
 const list=route('../app/api/clips/[id]/media/route.ts'); assert.equal((await list.handlers.GET(body(),context)).status,200);
 assert.deepEqual(list.calls,[{name:'list',args:['user',clipId]}]);
 const preview=route('../app/api/clips/[id]/media/[assetId]/route.ts'); assert.equal((await preview.handlers.GET(body(),context)).status,200);
 assert.deepEqual(preview.calls,[{name:'preview',args:['user',clipId,assetId]}]);
 const unavailable=route('../app/api/clips/[id]/media/route.ts',{assetError:new EditorAssetError('Apply 023_editor_media.sql',503)});
 const response=await unavailable.handlers.GET(body(),context);assert.equal(response.status,503);assert.match((await response.json()).error,/023_editor_media/);
});
test('finalization runs on processing only with Bearer auth and Pro, with CORS responses',async()=>{
 const file='../app/api/clips/[id]/media/[assetId]/finalize/route.ts';
 const req=new Request('https://test/api',{method:'POST',headers:{Authorization:'Bearer token'}});
 const valid=route(file);const response=await valid.handlers.POST(req,context);assert.equal(response.status,200);assert.equal(response.headers.get('Access-Control-Allow-Origin'),'*');
 assert.deepEqual(valid.calls,[{name:'finalize',args:['user',clipId,assetId]}]);
 for(const [options,request,status] of [[{target:'frontend'},req,404],[{},body(),401],[{signedOut:true},req,401],[{pro:false},req,403]] as const){
  const denied=route(file,options);assert.equal((await denied.handlers.POST(request,context)).status,status);assert.equal(denied.calls.length,0);
 }
});
test('draft save rejects unowned or missing assets before database mutation and leaves legacy drafts usable',async()=>{
 const file='../app/api/clips/[id]/edit-draft/route.ts';
 const request=(value:any)=>new Request('https://test/api',{method:'PUT',body:JSON.stringify({draft:value})});
 const rejected=route(file,{assetError:new EditorAssetError('Media asset not found.',404)});
 assert.equal((await rejected.handlers.PUT(request(draft),context)).status,404);
 assert.equal(rejected.calls.filter(c=>c.name==='save').length,0);
 const valid=route(file);assert.equal((await valid.handlers.PUT(request(draft),context)).status,200);
 assert.deepEqual(valid.calls.map(c=>c.name),['validate','save']);
 const legacy=route(file);assert.equal((await legacy.handlers.PUT(request({...draft,version:2,cutaways:undefined}),context)).status,200);
});
