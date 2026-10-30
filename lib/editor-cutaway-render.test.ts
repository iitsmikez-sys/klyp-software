import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveBin, run, runCapture } from './bin.ts';
import { resolveCutawaySpans } from './editor-timeline.ts';
import { renderKeptSegments } from './editor-render.ts';
import * as cutawayRender from './editor-cutaway-render.ts';
const renderer: any = cutawayRender;
const build = (...args: any[]) => { assert.equal(typeof renderer.buildCutawayGraph, 'function', 'cutaway compositor must exist'); return renderer.buildCutawayGraph(...args); };
const visual = {id:'visual',asset_id:'photo',source_start_ms:100500,source_end_ms:103500,asset_in_ms:0,fit:'cover',focal_point:{x:0.5,y:0.5}};
const span = {...visual,start_ms:500,end_ms:1000};
const asset = {id:'photo',localPath:'/trusted/photo.png',kind:'photo',mime_type:'image/png',width:128,height:64,duration_ms:null};
const size = {w:64,h:64};

test('no cutaways preserve the base graph; missing assets reject instead of dropping visuals', () => {
 assert.deepEqual(build('framed',[],[],size),{filter:'',videoLabel:'framed'});
 assert.throws(()=>build('framed',[span],[],size),/asset/i);
});
test('photo cover uses the chosen focal position and contain creates an opaque full canvas', () => {
 const cover=build('framed',[{...span,focal_point:{x:1,y:0}}],[asset],size);
 assert.match(cover.filter,/crop=64:64:\(iw-ow\)\*1:\(ih-oh\)\*0/);
 assert.match(cover.filter,/gte\(t,0.5\)\*lt\(t,1\)/);
 assert.match(cover.filter,/loop=/);
 const contain=build('framed',[{...span,fit:'contain'}],[asset],size);
 assert.match(contain.filter,/pad=64:64/);
 assert.doesNotMatch(cover.filter,/\[1:a/);
});
test('foreground overlay keeps the source picture visible and uses a bounded rectangle',()=>{
 const overlay={...span,placement:'overlay',rect:{x:.25,y:.25,w:.5,h:.5}};
 const graph=build('framed',[overlay],[asset],size);
 assert.match(graph.filter,/overlay=x=16:y=16/);
 assert.doesNotMatch(graph.filter,/cutbg/);
 assert.match(graph.filter,/scale=w='if\(gte\(dar,32\/32\)/);
});
test('overlay audio is mixed only when explicitly enabled and present',()=>{
 const clip={...span,placement:'overlay' as const,rect:{x:.2,y:.2,w:.4,h:.4},muted:false};
 const video={...asset,id:'photo',kind:'video' as const,mime_type:'video/mp4',duration_ms:3000};
 const graph=renderer.buildOverlayAudioGraph([clip],[video],[true],true,2);
 assert.match(graph.filter,/atrim=start=0:end=0.5/);
 assert.match(graph.filter,/adelay=delays=500:all=1/);
 assert.match(graph.filter,/amix=inputs=2/);
 assert.equal(graph.audioLabel,'exportaudio');
 assert.equal(renderer.buildOverlayAudioGraph([{...clip,muted:true}],[video],[true],true,2).audioLabel,null);
 assert.equal(renderer.buildOverlayAudioGraph([clip],[video],[false],true,2).audioLabel,null);
});
test('real FFmpeg overlay keeps source sound and adds imported video sound only in its window',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'editor-overlay-audio-'));try{
  const source=path.join(dir,'source.mp4'),imported=path.join(dir,'imported.mp4'),output=path.join(dir,'output.mp4'),pcm=path.join(dir,'audio.pcm');
  for(const [file,color,tone,duration] of [[source,'red','440','2'],[imported,'blue','880','1']] as const)
   await run(resolveBin('ffmpeg'),['-v','error','-f','lavfi','-i',`color=c=${color}:s=64x64:r=30:d=${duration}`,'-f','lavfi','-i',`sine=frequency=${tone}:sample_rate=48000:duration=${duration}`,'-c:v','libx264','-threads','2','-pix_fmt','yuv420p','-c:a','aac','-y',file]);
  const overlay={...span,placement:'overlay' as const,rect:{x:.25,y:.25,w:.5,h:.5},muted:false,start_ms:500,end_ms:1500,asset_in_ms:0};
  const media={...asset,kind:'video' as const,mime_type:'video/mp4',duration_ms:1000,localPath:imported};
  const picture=build('base',[overlay],[media],size),audio=renderer.buildOverlayAudioGraph([overlay],[media],[true],true,2);
  await run(resolveBin('ffmpeg'),['-v','error','-i',source,...renderer.cutawayInputArgs([media]),'-filter_complex',`[0:v]format=yuv420p[base];${picture.filter};${audio.filter}`,'-map',`[${picture.videoLabel}]`,'-map',`[${audio.audioLabel}]`,'-c:v','libx264','-threads','2','-pix_fmt','yuv420p','-c:a','aac','-y',output]);
  await run(resolveBin('ffmpeg'),['-v','error','-i',output,'-vn','-ar','48000','-ac','1','-f','s16le','-y',pcm]);const samples=await readFile(pcm);
  const tone=(at:number,hz:number)=>{let real=0,imag=0;const start=Math.round(at*48000),count=4800;for(let n=0;n<count;n++){const sample=samples.readInt16LE((start+n)*2),phase=2*Math.PI*hz*n/48000;real+=sample*Math.cos(phase);imag+=sample*Math.sin(phase);}return Math.hypot(real,imag)/count;};
  assert.ok(tone(.2,440)>tone(.2,880)*3,'source audio remains before overlay');
  assert.ok(tone(.8,880)>tone(.2,880)*5,'imported audio begins with overlay');
  assert.ok(tone(.8,440)>tone(.2,880)*5,'source audio continues under overlay');
  assert.ok(tone(1.7,440)>tone(1.7,880)*3,'source audio remains afterward');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('real MP4 foreground photo covers only its rectangle',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'editor-overlay-pixels-'));try{
  const source=path.join(dir,'source.mp4'),photo=path.join(dir,'blue.png'),output=path.join(dir,'output.mp4'),frame=path.join(dir,'frame.rgb');
  await run(resolveBin('ffmpeg'),['-v','error','-f','lavfi','-i','color=c=red:s=64x64:r=30:d=1','-c:v','libx264','-pix_fmt','yuv420p','-y',source]);
  await run(resolveBin('ffmpeg'),['-v','error','-f','lavfi','-i','color=c=blue:s=32x32','-frames:v','1','-y',photo]);
  const overlay={...visual,placement:'overlay' as const,rect:{x:.25,y:.25,w:.5,h:.5},start_ms:0,end_ms:1000,source_end_ms:101500};
  const uploaded={...asset,kind:'photo' as const,localPath:photo,width:32,height:32};const graph=build('base',[overlay],[uploaded],size);
  await run(resolveBin('ffmpeg'),['-v','error','-i',source,...cutawayRender.cutawayInputArgs([uploaded]),'-filter_complex',`[0:v]format=yuv420p[base];${graph.filter};[${graph.videoLabel}]format=yuv420p[out]`,'-map','[out]','-c:v','libx264','-pix_fmt','yuv420p','-y',output]);
  await run(resolveBin('ffmpeg'),['-v','error','-ss','0.5','-i',output,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','-y',frame]);
  const pixels=await readFile(frame),pixel=(x:number,y:number)=>pixels.subarray((y*64+x)*3,(y*64+x)*3+3);
  const outside=pixel(4,4),inside=pixel(32,32);assert.ok(outside[0]>outside[2]+100);assert.ok(inside[2]>inside[0]+100);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('video spans use surviving source offsets and never reference imported audio', () => {
 const spans=resolveCutawaySpans({version:3,cutaways:[{...visual,asset_id:'video',asset_in_ms:500}],segments:[{id:'a',start_seconds:100,end_seconds:101},{id:'b',start_seconds:103,end_seconds:104}]} as any);
 const graph=build('framed',spans,[{...asset,id:'video',kind:'video',mime_type:'video/mp4',duration_ms:4000}],size);
 assert.match(graph.filter,/trim=start=0.5:end=1/);
 assert.match(graph.filter,/trim=start=3:end=3.5/);
 assert.doesNotMatch(graph.filter,/\[1:a|amix|concat=.*a=1/);
 assert.throws(()=>build('framed',spans,[{...asset,id:'video',kind:'video',mime_type:'video/mp4',duration_ms:1000}],size),/duration/i);
});

test('materialization accepts only verified owner/clip assets and server paths; incomplete downloads reject', async()=>{
 assert.equal(typeof renderer.loadEditorCutawayAssets,'function','owned asset materializer must exist');
 const dir=await mkdtemp(path.join(tmpdir(),'cutaway-owned-'));
 const draft={version:3,cutaways:[visual]} as any;
 const verified={...asset,user_id:'user',clip_id:'clip',status:'verified',storage_path:'user/clip/asset.png',size_bytes:3};
 const requests:string[]=[];
 const deps={validate:async()=>{},owned:async()=>verified,download:async(a:any)=>{requests.push(a.storage_path);return new Response(new Uint8Array([1,2,3]));}};
 try {
  const result=await renderer.loadEditorCutawayAssets('user','clip',draft,dir,deps);
  assert.deepEqual(await readFile(result[0].localPath),Buffer.from([1,2,3]));
  assert.equal(path.dirname(result[0].localPath),dir);
  assert.deepEqual(requests,['user/clip/asset.png']);
  for(const bad of [{user_id:'foreign'},{clip_id:'other'},{status:'pending'}]) {
   await assert.rejects(renderer.loadEditorCutawayAssets('user','clip',draft,dir,{...deps,owned:async()=>({...verified,...bad})}),/verified|owned/i);
  }
  await assert.rejects(renderer.loadEditorCutawayAssets('user','clip',draft,dir,{...deps,download:async()=>new Response(new Uint8Array([1,2]))}),/size|incomplete/i);
  await assert.rejects(renderer.loadEditorCutawayAssets('user','clip',draft,dir,{...deps,download:async()=>new Response(new Uint8Array([1,2,3,4]))}),/size/i);
  assert.deepEqual(await readdir(dir),[],'failed downloads leave no partial file');
  await assert.rejects(renderer.loadEditorCutawayAssets('user','clip',draft,dir,{...deps,download:async()=>new Response(null,{status:404})}),/missing/i);
 } finally {await rm(dir,{recursive:true,force:true});}
});

test('real MP4 displays timed photos and muted videos over kept source audio, with text effects above visuals',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'cutaway-fixture-'));
 try {
  const source=path.join(dir,'source.mp4'), kept=path.join(dir,'kept.mp4'), photo=path.join(dir,'photo.png'), video=path.join(dir,'video.mp4'), output=path.join(dir,'output.mp4');
  await run(resolveBin('ffmpeg'),['-v','error','-f','lavfi','-i','color=red:s=128x64:r=30:d=4','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=4','-c:v','libx264','-threads','2','-pix_fmt','yuv420p','-c:a','aac','-y',source]);
  await run(resolveBin('ffmpeg'),['-v','error','-f','lavfi','-i','color=lime:s=128x64','-frames:v','1','-y',photo]);
  await run(resolveBin('ffmpeg'),['-v','error','-f','lavfi','-i','color=blue:s=64x64:r=24:d=2','-f','lavfi','-i','color=yellow:s=64x64:r=24:d=2','-f','lavfi','-i','sine=frequency=880:sample_rate=48000:duration=4','-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0[v]','-map','[v]','-map','2:a','-c:v','libx264','-threads','2','-pix_fmt','yuv420p','-c:a','aac','-y',video]);
  const segments=[{id:'a',start_seconds:100,end_seconds:101},{id:'b',start_seconds:103,end_seconds:104}];
  await renderKeptSegments(source,100,segments,kept);
  const spans=resolveCutawaySpans({version:3,segments,cutaways:[{...visual,source_end_ms:100900},{...visual,id:'v',asset_id:'video',source_start_ms:100900,source_end_ms:103500,asset_in_ms:500}]} as any);
  const assets=[{...asset,localPath:photo},{...asset,id:'video',localPath:video,kind:'video',mime_type:'video/mp4',width:64,duration_ms:4000}];
  const graph=build('framed',spans,assets,size);
  assert.equal(typeof renderer.cutawayInputArgs,'function');
  await run(resolveBin('ffmpeg'),['-v','error','-i',kept,...renderer.cutawayInputArgs(assets),'-filter_complex_threads','2','-filter_complex',`[0:v]scale=64:64[framed];${graph.filter};[${graph.videoLabel}]drawbox=x=0:y=0:w=8:h=8:color=white:t=fill[final]`,'-map','[final]','-map','0:a?','-t','2','-c:v','libx264','-threads','2','-pix_fmt','yuv420p','-c:a','aac','-y',output]);
  const info=JSON.parse(await runCapture(resolveBin('ffprobe'),['-v','error','-show_entries','format=duration:stream=codec_type,width,height','-of','json',output]));
  assert.ok(Math.abs(Number(info.format.duration)-2)<0.08);
  assert.deepEqual(info.streams.map((s:any)=>s.codec_type),['video','audio']);
  assert.deepEqual([info.streams[0].width,info.streams[0].height],[64,64]);
  for(const [time,color] of [[0.2,'red'],[0.5,'green'],[0.8,'green'],[0.9,'blue'],[1.1,'yellow'],[1.5,'red'],[1.8,'red']] as const){
   const file=path.join(dir,`frame-${time}.rgb`);
   await run(resolveBin('ffmpeg'),['-v','error','-ss',String(time),'-i',output,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','-y',file]);
   const pixels=await readFile(file),pixel=pixels.subarray((32*64+32)*3,(32*64+32)*3+3);
   const expected={red:[255,0,0],green:[0,255,0],blue:[0,0,255],yellow:[255,255,0]}[color];
   assert.ok(expected.every((value,index)=>Math.abs(pixel[index]-value)<70),`${time}s expected ${color}, got ${Array.from(pixel)}`);
   assert.ok(pixels[(3*64+3)*3]>200,'post-cutaway overlay remains visible');
  }
  const pcm=path.join(dir,'audio.pcm');
  await run(resolveBin('ffmpeg'),['-v','error','-i',output,'-vn','-ar','48000','-ac','1','-f','s16le','-y',pcm]);
  const data=await readFile(pcm);
  for(const begin of [0.1,0.6,1.1,1.6]){let crossings=0,previous=0;for(let i=Math.round(begin*48000);i<Math.round((begin+0.2)*48000);i++){const value=data.readInt16LE(i*2);if(value>=0&&previous<0)crossings++;previous=value;}assert.ok(Math.abs(crossings/0.2-440)<20,`source tone at ${begin}s: ${crossings/0.2}`);}
 } finally {await rm(dir,{recursive:true,force:true});}
});

test('real focal crops choose image edges, contain pads black, and transparency hides the source picture',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'cutaway-fit-'));
 try {
  const photo=path.join(dir,'photo.png'),transparent=path.join(dir,'transparent.png');
  await run(resolveBin('ffmpeg'),['-v','error','-f','lavfi','-i','color=lime:s=128x64,drawbox=x=64:y=0:w=64:h=64:color=blue:t=fill','-frames:v','1','-y',photo]);
  await run(resolveBin('ffmpeg'),['-v','error','-f','lavfi','-i','color=red@0.0:s=128x64,format=rgba','-frames:v','1','-y',transparent]);
  for(const [name,fit,x,file] of [['left','cover',0,photo],['right','cover',1,photo],['contain','contain',0.5,photo],['containTop','contain',0.5,photo],['transparent','cover',0.5,transparent]] as const){
   const assets=[{...asset,localPath:file}];
   const graph=build('framed',[{...span,start_ms:0,end_ms:1000,fit,focal_point:{x,y:name==='containTop'?0:0.5}}],assets,size);
   const output=path.join(dir,`${name}.rgb`);
   await run(resolveBin('ffmpeg'),['-v','error','-f','lavfi','-i','color=red:s=64x64:r=30:d=1',...renderer.cutawayInputArgs(assets),'-filter_complex_threads','2','-filter_complex',`[0:v]null[framed];${graph.filter}`,'-map',`[${graph.videoLabel}]`,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-y',output]);
   const pixels=await readFile(output);
   const pixel=(x:number,y:number)=>Array.from(pixels.subarray((y*64+x)*3,(y*64+x)*3+3));
   if(name==='left')assert.ok(pixel(32,32)[1]>200 && pixel(32,32)[2]<40);
   if(name==='right')assert.ok(pixel(32,32)[2]>200 && pixel(32,32)[1]<40);
   if(name==='contain'){assert.ok(pixel(32,3).every(v=>v<20));assert.ok(pixel(8,32)[1]>200);assert.ok(pixel(56,32)[2]>200);}
   if(name==='containTop'){assert.ok(pixel(8,3)[1]>200,'contain focal position aligns the picture to the top');assert.ok(pixel(32,60).every(v=>v<20));}
   if(name==='transparent')assert.ok(pixel(32,32).every(v=>v<20),`transparent area should be black: ${pixel(32,32)}`);
  }
 }finally{await rm(dir,{recursive:true,force:true});}
});

for(const sar of ['2/1','1/2'] as const) for(const fit of ['cover','contain'] as const) {
 test(`real video ${fit} preserves display geometry for pixel aspect ratio ${sar}`,async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'cutaway-sar-'));
  try {
   const input=path.join(dir,'input.mp4'),output=path.join(dir,'output.mp4'),frame=path.join(dir,'frame.rgb');
   const blueHalf=sar==='2/1'?'x=32:y=0:w=32:h=64':'x=0:y=32:w=64:h=32';
   await run(resolveBin('ffmpeg'),['-v','error','-f','lavfi','-i',`color=lime:s=64x64:r=30:d=1,drawbox=${blueHalf}:color=blue:t=fill,setsar=${sar}`,'-c:v','libx264','-threads','2','-pix_fmt','yuv420p','-y',input]);
   const sourceInfo=JSON.parse(await runCapture(resolveBin('ffprobe'),['-v','error','-select_streams','v:0','-show_entries','stream=width,height,sample_aspect_ratio','-of','json',input])).streams[0];
   assert.deepEqual([sourceInfo.width,sourceInfo.height,sourceInfo.sample_aspect_ratio],[64,64,sar.replace('/',':')]);
   const assets=[{...asset,kind:'video',mime_type:'video/mp4',width:64,height:64,duration_ms:1000,localPath:input}];
   const graph=build('framed',[{...span,start_ms:0,end_ms:1000,fit,focal_point:fit==='cover'?{x:1,y:1}:{x:0.5,y:0.5}}],assets,size);
   await run(resolveBin('ffmpeg'),['-v','error','-f','lavfi','-i','color=red:s=64x64:r=30:d=1',...renderer.cutawayInputArgs(assets),'-filter_complex_threads','2','-filter_complex',`[0:v]null[framed];${graph.filter}`,'-map',`[${graph.videoLabel}]`,'-t','1','-c:v','libx264','-threads','2','-pix_fmt','yuv420p','-y',output]);
   const info=JSON.parse(await runCapture(resolveBin('ffprobe'),['-v','error','-select_streams','v:0','-show_entries','stream=width,height,sample_aspect_ratio','-of','json',output])).streams[0];
   assert.deepEqual([info.width,info.height,info.sample_aspect_ratio],[64,64,'1:1']);
   await run(resolveBin('ffmpeg'),['-v','error','-ss','0.2','-i',output,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-y',frame]);
   const pixels=await readFile(frame);
   const pixel=(x:number,y:number)=>Array.from(pixels.subarray((y*64+x)*3,(y*64+x)*3+3));
   if(fit==='cover') {
    for(const [x,y] of [[8,8],[8,56],[56,8],[56,56]])assert.ok(pixel(x,y)[2]>200&&pixel(x,y)[1]<40,`focal edge should fill the frame with blue at ${x},${y}, got ${pixel(x,y)}`);
   } else if(sar==='2/1') {
    assert.ok(pixel(32,8).every(v=>v<20),'wide display must leave black padding above');
    assert.ok(pixel(32,56).every(v=>v<20),'wide display must leave black padding below');
    assert.ok(pixel(8,32)[1]>200&&pixel(56,32)[2]>200,'wide display retains both halves');
   } else {
    assert.ok(pixel(8,32).every(v=>v<20),'tall display must leave black padding on the left');
    assert.ok(pixel(56,32).every(v=>v<20),'tall display must leave black padding on the right');
    assert.ok(pixel(32,8)[1]>200&&pixel(32,56)[2]>200,'tall display retains both halves');
   }
  } finally {await rm(dir,{recursive:true,force:true});}
 });
}
