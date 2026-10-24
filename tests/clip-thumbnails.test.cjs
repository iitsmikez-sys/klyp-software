const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
function setup(fetch){
 let timeout; let urls=0;
 const code=ts.transpileModule(fs.readFileSync('lib/clip-thumbnails.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
 const context={exports:{},require:()=>({processingFetch:fetch}),AbortController,URL:{createObjectURL:()=> 'blob:'+ ++urls},setTimeout:(f)=>{timeout=f;return 1},clearTimeout:()=>{}};
 vm.runInNewContext(code,context);
 return {...context.exports,expire:()=>timeout()};
}
const clip={url:'https://youtu.be/example',start_seconds:1.1,end_seconds:4.1};
const response={ok:true,blob:async()=>({size:100,type:'image/jpeg'})};
test('simultaneous consumers share one request and a successful frame is reused',async()=>{
 let calls=0;const api=setup(async()=>{calls++;return response});
 const first=api.loadClipThumbnail(clip);assert.equal(first,api.loadClipThumbnail(clip));
 const url=await first;assert.equal(await api.loadClipThumbnail(clip),url);assert.equal(calls,1);
});
test('different fractional ranges do not share a thumbnail',async()=>{
 let calls=0;const api=setup(async()=>{calls++;return response});
 await api.loadClipThumbnail(clip);await api.loadClipThumbnail({...clip,start_seconds:1.2});assert.equal(calls,2);
});
test('hung request times out and a subsequent attempt succeeds',async()=>{
 let calls=0;const api=setup(()=>++calls===1?new Promise(()=>{}):Promise.resolve(response));
 const request=api.loadClipThumbnail(clip);api.expire();await assert.rejects(request,/timed out/);
 assert.equal(await api.loadClipThumbnail(clip),'blob:1');
});
test('late response after timeout never enters the cache',async()=>{
 let resolve;const api=setup(()=>new Promise(r=>resolve=r));const request=api.loadClipThumbnail(clip);
 api.expire();await assert.rejects(request);resolve(response);await new Promise(r=>setImmediate(r));assert.equal(api.peekClipThumbnail(clip),null);
});
test('invalid image payload and HTTP errors are retryable',async()=>{
 let calls=0;const api=setup(async()=>++calls===1?{ok:false,status:403}:calls===2?{ok:true,blob:async()=>({size:10,type:'text/html'})}:response);
 await assert.rejects(api.loadClipThumbnail(clip),/403/);await assert.rejects(api.loadClipThumbnail(clip),/Invalid/);assert.equal(await api.loadClipThumbnail(clip),'blob:1');
});
test('image decode failure invalidation allows a fresh request',async()=>{
 const api=setup(async()=>response);await api.loadClipThumbnail(clip);api.invalidateClipThumbnail(clip);assert.equal(api.peekClipThumbnail(clip),null);assert.equal(await api.loadClipThumbnail(clip),'blob:2');
});
