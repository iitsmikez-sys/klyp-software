import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { run, runCapture, resolveBin } from './bin.ts';
import * as assets from './editor-assets.ts';
import * as store from './editor-assets-store.ts';
import * as admin from './supabase/admin.ts';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { chromium } from 'playwright';
import { testProcessRunner } from '../tests/helpers/process-runner.ts';
import * as probeModule from './editor-asset-probe.ts';
const {probeEditorAssetFile}=probeModule;
import { buildCutawayGraph, cutawayInputArgs } from './editor-cutaway-render.ts';
import { cutawayAtOutputTime } from './editor-timeline.ts';

test('missing visual duration requires complete presentation timestamps, never container audio duration',()=>{
 const duration=(probeModule as any).visualPacketDurationMs;
 assert.equal(typeof duration,'function');
 assert.equal(duration([{pts_time:'0.007',duration_time:'0.5'},{pts_time:'0.507',duration_time:'0.5'}]),1000);
 for(const packets of [[],[{pts_time:'N/A',duration_time:'1'}],[{pts_time:'0',duration_time:'N/A'}],[{pts_time:'0',duration_time:'0'}]]) assert.throws(()=>duration(packets),/duration|timestamp/);
});

test('audio tail cannot extend visual duration or the accepted preview/export interval',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'editor-audio-tail-'));
 try {
  for(const [extension,codec,mime] of [['mp4','libx264','video/mp4'],['webm','libvpx-vp9','video/webm']]) {
   const file=path.join(dir,`tail.${extension}`);
   await run(resolveBin('ffmpeg'),['-v','error','-f','lavfi','-i','color=blue:s=32x32:r=30:d=2','-f','lavfi','-i','sine=duration=6','-c:v',codec,'-threads','1','-c:a',extension==='webm'?'libopus':'aac','-y',file]);
   const meta=await probeEditorAssetFile(file,'video',mime);
   assert.ok(meta.duration_ms!>=1990&&meta.duration_ms!<=2010,`two seconds of picture must not inherit six seconds of audio: ${meta.duration_ms}`);
   const span={id:'cut',asset_id:'asset',source_start_ms:500,source_end_ms:2500,start_ms:500,end_ms:2500,asset_in_ms:0,fit:'cover' as const,focal_point:{x:.5,y:.5}};
   const asset={...meta,id:'asset',localPath:file};
   assert.throws(()=>buildCutawayGraph('base',[{...span,end_ms:3500}],[asset],{w:32,h:32}),/duration/);
   const graph=buildCutawayGraph('base',[span],[asset],{w:32,h:32});
   const output=path.join(dir,`output-${extension}.rgb`);
   await run(resolveBin('ffmpeg'),['-v','error','-f','lavfi','-i','color=red:s=32x32:r=30:d=3',...cutawayInputArgs([asset]),'-filter_complex_threads','1','-filter_complex',`[0:v]null[base];${graph.filter}`,'-map',`[${graph.videoLabel}]`,'-t','3','-pix_fmt','rgb24','-f','rawvideo','-y',output]);
   const pixels=await readFile(output);
   for(const [frame,blue] of [[14,false],[15,true],[74,true],[75,false],[80,false]] as const){
    const pixel=pixels.subarray(frame*32*32*3,frame*32*32*3+3);
    assert.ok(blue?pixel[2]>200&&pixel[0]<30:pixel[0]>200&&pixel[2]<30,`${extension} frame ${frame} should be ${blue?'import':'source'}: ${pixel}`);
    assert.equal(!!cutawayAtOutputTime([span],frame/30),blue,'browser interval agrees at visual boundary');
   }
   const browser=await chromium.launch({channel:'chrome',headless:true});
   try {
    const page=await browser.newPage();page.on('pageerror',error=>console.error(error));await page.setContent('<div id="root"></div>');
    const require=createRequire(import.meta.url);
    await page.addScriptTag({path:require.resolve('react').replace(/index\.js$/,'umd/react.development.js')});
    await page.addScriptTag({path:require.resolve('react-dom').replace(/index\.js$/,'umd/react-dom.development.js')});
    const sources=Object.fromEntries(['components/EditorCutawayPreview.tsx','lib/editor-media-client.ts','lib/editor-timeline.ts'].map(name=>[name.replace(/\.tsx?$/,''),ts.transpileModule(readFileSync(new URL('../'+name,import.meta.url),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText]));
    await page.evaluate(({sources,asset,span,data,mime})=>{
     const w=window as any,React=w.React;
     const jsx=(t:any,p:any)=>React.createElement(t,p);
     const modules:any={react:React,'react/jsx-runtime':{jsx,jsxs:jsx}};
     const load=(id:string):any=>{if(modules[id])return modules[id];const exports={};modules[id]=exports;new Function('require','exports',sources[id])((name:string)=>load(name.startsWith('@/')?name.slice(2):name.startsWith('./')?'lib/'+name.slice(2).replace(/\.ts$/,''):name),exports);return exports;};
     w.fetch=async()=>Response.json({asset,preview_url:`data:${mime};base64,${data}`,expires_in:300});
     w.root=w.ReactDOM.createRoot(document.getElementById('root'));w.picture=null;
     w.render=(time:number)=>w.root.render(React.createElement(load('components/EditorCutawayPreview').default,{clipId:'clip',active:load('lib/editor-timeline').cutawayAtOutputTime([span],time),outputTime:time,playing:false,sourceVideo:null,onPicture:(p:any)=>w.picture=p}));
     w.render(74/30);
    },{sources,asset,span,data:(await readFile(file)).toString('base64'),mime});
    await page.waitForFunction(()=>{const v=(window as any).picture?.element as HTMLVideoElement;return v&&!v.seeking&&v.readyState>=2&&v.currentTime>1.9;});
    assert.equal(await page.evaluate(()=>{const v=(window as any).picture.element;const c=document.createElement('canvas');c.width=c.height=1;const ctx=c.getContext('2d')!;ctx.drawImage(v,0,0,1,1);return ctx.getImageData(0,0,1,1).data[2]>200;}),true,'mounted browser draws last blue picture before boundary');
    await page.evaluate(()=>(window as any).render(2.5));await page.waitForFunction(()=>(window as any).picture===null);
    assert.equal(await page.locator('video').count(),0,'mounted preview removes import at 2.5s despite six-second container audio');
   } finally {await browser.close();}
  }
 } finally {await rm(dir,{recursive:true,force:true});}
});

// Replace only binary dispatch for infrastructure failures; retain real runner, file IO and validation.
function probeWithBinaryFailure(failure:'probe-missing'|'decode-missing'|'timeout'|'resource'|'signal') {
 const binary=testProcessRunner();
 const realRequire=createRequire(import.meta.url);
 const missing=path.join(tmpdir(),'klyp-does-not-exist-ffmpeg');
 const code=ts.transpileModule(readFileSync(new URL('./editor-asset-probe.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 const modules:Record<string,unknown>={
  './bin.ts':{...binary,resolveBin:(name:'ffmpeg'|'ffprobe')=>failure==='probe-missing'&&name==='ffprobe'||failure==='decode-missing'&&name==='ffmpeg'?missing:resolveBin(name),run:failure==='timeout'?()=>binary.run(process.execPath,['-e','setTimeout(()=>{},500)'],{maxRunMs:100}):failure==='resource'?()=>binary.run(process.execPath,['-e','process.stderr.write("Cannot allocate memory");process.exit(1)']):failure==='signal'?()=>binary.run('klyp-signal-fixture',[]):binary.run},
  './editor-assets.ts':assets,'./editor-assets-store.ts':store,'./supabase/admin.ts':admin,
 };
 const context={exports:{} as any,require:(name:string)=>modules[name]??realRequire(name),Buffer,process,console,fetch,AbortSignal};
 vm.runInNewContext(code,context);
 return context.exports.probeEditorAssetFile as typeof probeEditorAssetFile;
}

test('real cover artwork preceding audio/movie tracks cannot hide corrupt movie packets',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'editor-cover-art-test-'));
 try {
  const file=path.join(dir,'artwork-first.mp4');
  await run(resolveBin('ffmpeg'),['-v','error','-f','lavfi','-i','color=red:s=16x16:r=1:d=1','-f','lavfi','-i','color=blue:s=64x48:r=10:d=1','-f','lavfi','-i','sine=duration=1','-map','0:v','-map','2:a','-map','1:v','-c:v:0','mjpeg','-c:v:1','libx264','-c:a','aac','-disposition:v:0','attached_pic','-threads','1','-y',file]);
  const data=await readFile(file);
  // Reorder same-sized moov children, leaving all media offsets and payloads intact.
  for(let offset=0;offset<data.length;) {
   const size=data.readUInt32BE(offset);
   if(data.toString('ascii',offset+4,offset+8)==='moov') {
    const children:Buffer[]=[];for(let child=offset+8;child<offset+size;){const length=data.readUInt32BE(child);children.push(Buffer.from(data.subarray(child,child+length)));child+=length;}
    children.sort((a,b)=>Number(b.toString('ascii',4,8)==='udta')-Number(a.toString('ascii',4,8)==='udta'));
    Buffer.concat(children).copy(data,offset+8);break;
   }
   offset+=size;
  }
  await writeFile(file,data);
  const info=JSON.parse(await runCapture(resolveBin('ffprobe'),['-v','error','-show_entries','stream=index,codec_type:stream_disposition=attached_pic:packet=stream_index,pos,size','-of','json',file]));
  assert.equal(info.streams[0].disposition.attached_pic,1,'fixture must place attached artwork first');
  const movie=info.streams.find((s:any)=>s.codec_type==='video'&&!s.disposition.attached_pic);
  assert.equal(movie.index,2,'audio must separate artwork and movie absolute indexes');
  assert.equal((await probeEditorAssetFile(file,'video','video/mp4')).width,64);
  const packets=info.packets.filter((p:any)=>p.stream_index===movie.index);assert.ok(packets.length>0);
  for(const packet of packets) data.fill(0xff,Number(packet.pos),Number(packet.pos)+Number(packet.size));
  await writeFile(file,data);
  await assert.rejects(probeEditorAssetFile(file,'video','video/mp4'),error=>error instanceof assets.EditorAssetError&&error.status===400&&/decode/.test(error.message));
 }finally{await rm(dir,{recursive:true,force:true});}
});

for(const failure of ['probe-missing','decode-missing','timeout','resource','signal'] as const) test(`media verification reports retryable 503 for ${failure}`,async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'editor-probe-infra-test-'));
 try {
  const file=path.join(dir,'photo.png');await run(resolveBin('ffmpeg'),['-v','error','-f','lavfi','-i','color=red:s=16x16','-frames:v','1','-threads','1','-y',file]);
  await assert.rejects(probeWithBinaryFailure(failure)(file,'photo','image/png'),error=>error instanceof assets.EditorAssetError&&error.status===503&&/retry|try again/i.test(error.message));
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('real probe decodes PNG/JPEG/WebP and MP4/MOV/WebM, ignoring client duration',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'editor-asset-test-'));
 try {
  for(const [ext,codec,mime] of [['png','png','image/png'],['jpg','mjpeg','image/jpeg'],['webp','libwebp','image/webp'],['mp4','libx264','video/mp4'],['mov','libx264','video/quicktime'],['webm','libvpx-vp9','video/webm']]) {
   const file=path.join(dir,`valid.${ext}`); const photo=mime.startsWith('image');
   await run(resolveBin('ffmpeg'),['-v','error','-f','lavfi','-i','color=red:s=64x48:r=10:d=1','-c:v',codec,'-threads','1',...(photo?['-frames:v','1']:[]),'-y',file]);
   const meta=await probeEditorAssetFile(file,photo?'photo':'video',mime);
   assert.equal(meta.width,64); assert.equal(meta.height,48); assert.equal(meta.kind,photo?'photo':'video');
   if(!photo) assert.ok(meta.duration_ms!>=900 && meta.duration_ms!<=1100);
  }
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('rejects truncated image data and Matroska renamed as WebM',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'editor-disguised-test-'));
 try {
  const png=path.join(dir,'real.png');await run(resolveBin('ffmpeg'),['-v','error','-f','lavfi','-i','color=red:s=16x16','-frames:v','1','-threads','1','-y',png]);
  await writeFile(path.join(dir,'truncated.png'),(await readFile(png)).subarray(0,50));
  await assert.rejects(probeEditorAssetFile(path.join(dir,'truncated.png'),'photo','image/png'),/decode|dimensions/i);
  const mkv=path.join(dir,'disguised.webm');await run(resolveBin('ffmpeg'),['-v','error','-f','lavfi','-i','color=red:s=16x16:r=1:d=1','-c:v','libx264','-threads','1','-f','matroska','-y',mkv]);
  await assert.rejects(probeEditorAssetFile(mkv,'video','video/webm'),/WebM|format/i);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('rejects invalid bytes, mismatched actual format, audio-only files, and overlong videos',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'editor-invalid-test-'));
 try {
  const bad=path.join(dir,'bad.png'); await writeFile(bad,'not an image');
  await assert.rejects(probeEditorAssetFile(bad,'photo','image/png'),/valid|decode|format/i);
  const png=path.join(dir,'real.png'); await run(resolveBin('ffmpeg'),['-v','error','-f','lavfi','-i','color=red:s=16x16','-frames:v','1','-threads','1','-y',png]);
  await assert.rejects(probeEditorAssetFile(png,'video','video/mp4'),/format/i);
  const audio=path.join(dir,'audio.mp4'); await run(resolveBin('ffmpeg'),['-v','error','-f','lavfi','-i','sine=duration=1','-c:a','aac','-y',audio]);
  await assert.rejects(probeEditorAssetFile(audio,'video','video/mp4'),/video|visual/i);
  const long=path.join(dir,'long.mp4'); await run(resolveBin('ffmpeg'),['-v','error','-f','lavfi','-i','color=red:s=16x16:r=1:d=61','-c:v','libx264','-threads','1','-y',long]);
  await assert.rejects(probeEditorAssetFile(long,'video','video/mp4'),/60 seconds/i);
 }finally{await rm(dir,{recursive:true,force:true});}
});
