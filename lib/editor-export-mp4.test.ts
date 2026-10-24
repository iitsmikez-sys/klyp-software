import {isLegacyEditorExport} from './editor-compatibility.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import vm from 'node:vm';
import ts from 'typescript';
import { chromium } from 'playwright';
import * as bin from './bin.ts';
import * as editorRender from './editor-render.ts';
import * as timeline from './editor-timeline.ts';
import * as cutaways from './editor-cutaway-render.ts';
import * as drafts from './clip-edit-draft.ts';
import * as editorCaptions from './editor-captions.ts';
import * as captions from './captions.ts';
import * as clips from './clips.ts';
import * as vertical from './vertical-layout.ts';
import * as verticalFfmpeg from './vertical-layout-ffmpeg.ts';
import * as trim from './clip-trim.ts';
import { EditorAssetError } from './editor-assets.ts';

function measureAudioTones(audio: Buffer, start: number) {
 const sampleRate=48000, count=Math.round(.2*sampleRate), first=Math.round(start*sampleRate);
 assert.ok((first+count)*2<=audio.length,`${start}s: complete PCM window required`);
 let sourceReal=0,sourceImaginary=0,importedReal=0,importedImaginary=0,weightSum=0,energy=0;
 for(let n=0;n<count;n++) {
  const value=audio.readInt16LE((first+n)*2);
  // A Hann window limits spectral leakage from AAC distortion and cut edges.
  const weight=.5-.5*Math.cos(2*Math.PI*n/(count-1)), weighted=value*weight;
  const sourcePhase=2*Math.PI*440*n/sampleRate, importedPhase=2*Math.PI*880*n/sampleRate;
  sourceReal+=weighted*Math.cos(sourcePhase);sourceImaginary+=weighted*Math.sin(sourcePhase);
  importedReal+=weighted*Math.cos(importedPhase);importedImaginary+=weighted*Math.sin(importedPhase);
  weightSum+=weight;energy+=value*value;
 }
 const sourceAmplitude=2*Math.hypot(sourceReal,sourceImaginary)/weightSum;
 const importedAmplitude=2*Math.hypot(importedReal,importedImaginary)/weightSum;
 return {start,sourceAmplitude,importedAmplitude,importedRatio:importedAmplitude/sourceAmplitude,rms:Math.sqrt(energy/count)};
}

function assertSourceOnlyAudio(audio: Buffer, start: number) {
 const tones=measureAudioTones(audio,start);
 assert.ok(tones.sourceAmplitude>2000&&tones.rms>1000,`${start}s: 440Hz source audio must remain audible`);
 // Allow AAC artifacts up to 3% of source amplitude (about -30.5 dB).
 // This is a bounded absence check, not a claim of mathematically zero energy.
 assert.ok(tones.importedRatio<.03,`${start}s: imported 880Hz amplitude ratio ${tones.importedRatio} must be below 0.03`);
 return tones;
}

// Exercise the actual route and FFmpeg pipeline. Only account/storage/download
// boundaries are local fixtures; no credentials, network download, or Sparks.
test('export route returns playable MP4 with source cuts, imported pictures, audio, captions and hook timing', async () => {
 const dir = await fs.mkdtemp(path.join(tmpdir(), 'editor-export-mp4-'));
 const ff = (args: string[]) => bin.run(bin.resolveBin('ffmpeg'), ['-v', 'error', ...args]);
 try {
  const source = path.join(dir, 'source.mp4'), photo = path.join(dir, 'photo.png');
  const video = path.join(dir, 'video.mp4'), output = path.join(dir, 'output.mp4');
  await ff(['-f','lavfi','-i','color=red:s=270x480:r=30:d=6','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=6','-c:v','libx264','-threads','2','-pix_fmt','yuv420p','-c:a','aac','-y',source]);
  await ff(['-f','lavfi','-i','color=lime:s=270x480','-frames:v','1','-y',photo]);
  await ff(['-f','lavfi','-i','color=blue:s=270x480:r=24:d=2','-f','lavfi','-i','color=yellow:s=270x480:r=24:d=2','-f','lavfi','-i','sine=frequency=880:sample_rate=48000:duration=4','-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0[v]','-map','[v]','-map','2:a','-c:v','libx264','-threads','2','-pix_fmt','yuv420p','-c:a','aac','-y',video]);
  const clip = { id:'owned', url:'https://twitch.tv/videos/123', start_seconds:100, end_seconds:106, words:null, edit_draft:null };
  const draft = {
   version:3, start_seconds:100, end_seconds:106, title:'Synthetic export verification',
   hook:'LOCAL FIXTURE', hook_style:'CLASSIC', caption_style:'CLEAN', aspect_ratio:'Original',
   words:null, caption_color:'white', caption_position:'bottom', vertical_layout:null,
   segments:[{id:'a',start_seconds:100,end_seconds:102},{id:'b',start_seconds:104,end_seconds:106}],
   caption_cues:[{id:'one',start_ms:101250,end_ms:101750,text:'BEFORE CUT'},{id:'two',start_ms:104500,end_ms:105500,text:'AFTER CUT'}],
   cutaways:[
    {id:'p',asset_id:'photo',source_start_ms:100500,source_end_ms:101000,asset_in_ms:0,fit:'cover',focal_point:{x:.5,y:.5}},
    {id:'v',asset_id:'video',source_start_ms:101000,source_end_ms:105000,asset_in_ms:0,fit:'cover',focal_point:{x:.5,y:.5}},
   ],
  };
  const assets = [
   {id:'photo',localPath:photo,kind:'photo',mime_type:'image/png',width:270,height:480,duration_ms:null},
   {id:'video',localPath:video,kind:'video',mime_type:'video/mp4',width:270,height:480,duration_ms:4000},
  ];
  const db:any = {select:()=>db,eq:()=>db,maybeSingle:async()=>({data:clip,error:null})};
  class NextResponse extends Response { static json(body:unknown, init?:ResponseInit) { return new NextResponse(JSON.stringify(body),init); } }
  const modules:Record<string,unknown> = {
   '@/lib/editor-compatibility':{isLegacyEditorExport}, '@/lib/legacy-clip-export-route':{handleLegacyClipExport:()=>{throw Error('V3 export must not use legacy renderer');}},
   'next/server':{NextResponse}, 'fs/promises':fs, os:{tmpdir}, path,
   '@/lib/supabase/admin':{createAdminClient:()=>({from:()=>db})},
   '@/lib/editor-render':editorRender, '@/lib/editor-timeline':timeline,
   '@/lib/editor-assets':{EditorAssetError,assertOwnedDraftAssets:async()=>{}},
   '@/lib/editor-cutaway-render':{...cutaways,loadEditorCutawayAssets:async()=>assets},
   '@/lib/clip-edit-draft':drafts, '@/lib/editor-captions':editorCaptions,
   '@/lib/bin':bin, '@/lib/captions':captions, '@/lib/clips':clips,
   '@/lib/video-cache':{CACHE_DIR:dir,isUploadRef:()=>false,resolveSourceSegment:async()=>({path:source,offsetSeconds:100})},
   '@/lib/job-queue':{runQueued:async(_key:string,fn:()=>Promise<unknown>)=>fn()},
   '@/lib/watermark':{watermarkFilter:()=>{throw Error('Unexpected free export');}},
   '@/lib/profile-token':{bearerToken:()=> 'fixture',getProfileFromToken:async()=>({id:'user',tier:'pro',stripe_subscription_id:'fixture',sparks:0,vertical_layout:null}),consumeSparksFromToken:async()=>{throw Error('Fixture must never spend Sparks');}},
   '@/lib/vertical-layout':vertical, '@/lib/vertical-layout-ffmpeg':verticalFfmpeg,
   '@/lib/clip-archive':{getArchivedClip:async()=>null}, '@/lib/clip-trim':trim,
   '@/lib/sparks':{UPSCALE_COST:35}, '@/lib/cors':{withCors:(r:Response)=>r,corsPreflight:()=>{}},
  };
  const routeSource = await fs.readFile(new URL('../app/api/clip/route.ts',import.meta.url),'utf8');
  const routeCode = ts.transpileModule(routeSource,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  const exports:any = {};
  vm.runInNewContext(routeCode,{exports,require:(name:string)=>{assert.ok(name in modules,`Unexpected module ${name}`);return modules[name];},process:{env:{DEPLOYMENT_TARGET:'processing'}},console,Buffer,Response,Error,RangeError});
  const response:Response = await exports.POST({json:async()=>({clip_id:clip.id,edit_draft:draft})});
  assert.equal(response.status,200,response.status===200?'':await response.text());
  assert.equal(response.headers.get('content-type'),'video/mp4');
  await fs.writeFile(output,Buffer.from(await response.arrayBuffer()));
  const probe = JSON.parse(await bin.runCapture(bin.resolveBin('ffprobe'),['-v','error','-show_entries','format=duration:stream=codec_type,codec_name,width,height','-of','json',output]));
  assert.ok(Math.abs(Number(probe.format.duration)-4)<.08);
  assert.deepEqual(probe.streams.map((s:any)=>[s.codec_type,s.codec_name]),[['video','h264'],['audio','aac']]);
  assert.deepEqual([probe.streams[0].width,probe.streams[0].height],[270,480]);
  // Decode the whole file; check half-open boundaries and the video input skip
  // across deleted source seconds 102-104, including caption/hook end frames.
  const rgb = path.join(dir,'frames.rgb');
  await ff(['-i',output,'-an','-pix_fmt','rgb24','-f','rawvideo','-y',rgb]);
  const pixels = await fs.readFile(rgb), frameSize = 270*480*3;
  const checks = [
   [0.2,'red',true,false], [.5,'green',true,false], [.9,'green',true,false],
   [1,'blue',true,false], [1.5,'blue',true,true], [1.8,'blue',true,false],
   [2,'yellow',true,false], [2.5,'yellow',true,true], [2.9,'yellow',true,true],
   [3,'red',false,true], [3.4,'red',false,true], [3.5,'red',false,false], [3.9,'red',false,false],
  ] as const;
  for (const [seconds,color,hook,caption] of checks) {
   const frame = pixels.subarray(Math.round(seconds*30)*frameSize,(Math.round(seconds*30)+1)*frameSize);
   const center = Array.from(frame.subarray((240*270+135)*3,(240*270+135)*3+3));
   const expected = {red:[255,0,0],green:[0,255,0],blue:[0,0,255],yellow:[255,255,0]}[color];
   assert.ok(expected.every((v,i)=>Math.abs(center[i]-v)<60),`${seconds}s: ${color} picture, got ${center}`);
   const whitePixels = (startY:number,endY:number) => {
    let count = 0;
    for(let y=startY;y<endY;y++) for(let x=30;x<240;x++) {const i=(y*270+x)*3;if(frame[i]>190&&frame[i+1]>190&&frame[i+2]>190)count++;}
    return count;
   };
   assert.equal(whitePixels(25,130)>25,hook,`${seconds}s: hook timing`);
   assert.equal(whitePixels(400,475)>15,caption,`${seconds}s: caption timing`);
  }
  const pcm = path.join(dir,'audio.pcm');
  await ff(['-i',output,'-vn','-ar','48000','-ac','1','-f','s16le','-y',pcm]);
  const audio = await fs.readFile(pcm);
  const cleanTones=[];
  for(const start of [.1,.6,1.1,1.8,2.1,2.6,3.1,3.6]) {
   cleanTones.push(assertSourceOnlyAudio(audio,start));
  }
  // Negative control: deliberately mix the imported video's actual 880 Hz
  // audio at 40% into the real export, then AAC-encode and decode it again.
  // The same assertion must reject contamination after codec distortion.
  const contaminated = path.join(dir,'contaminated.mp4'), contaminatedPcm = path.join(dir,'contaminated.pcm');
  await ff(['-i',output,'-i',video,'-filter_complex','[0:a][1:a]amix=inputs=2:weights=1 0.4:normalize=0:duration=first[a]','-map','0:v','-map','[a]','-c:v','copy','-c:a','aac','-b:a','128k','-y',contaminated]);
  await ff(['-i',contaminated,'-vn','-ar','48000','-ac','1','-f','s16le','-y',contaminatedPcm]);
  const mixedAudio = await fs.readFile(contaminatedPcm);
  const contaminatedTones=[];
  for(const start of [1.1,1.8,2.1,2.6]) {
   const tones=measureAudioTones(mixedAudio,start);
   assert.ok(tones.importedRatio>.25&&tones.importedRatio<.55,`${start}s: negative control must contain the 40% imported tone after AAC encoding`);
   contaminatedTones.push(tones);
   assert.throws(()=>assertSourceOnlyAudio(mixedAudio,start),/imported 880Hz/,`${start}s: mixed imported audio must be detected`);
  }
  console.log('Audio spectral evidence:',JSON.stringify({cleanMaxRatio:Math.max(...cleanTones.map(t=>t.importedRatio)),contaminatedRatios:contaminatedTones.map(t=>t.importedRatio)}));
  const browser = await chromium.launch({channel:'chrome',headless:true});
  try {
   const page = await browser.newPage();
   await page.setContent('<video muted></video>');
   await page.locator('video').evaluate((element,data)=>{(element as HTMLVideoElement).src='data:video/mp4;base64,'+data;},(await fs.readFile(output)).toString('base64'));
   await page.waitForFunction(()=>document.querySelector('video')!.readyState>=2);
   assert.ok(Math.abs(await page.locator('video').evaluate(element=>(element as HTMLVideoElement).duration)-4)<.08);
   await page.locator('video').evaluate(async element=>{const v=element as HTMLVideoElement;v.currentTime=3.4;await v.play();});
   await page.waitForFunction(()=>document.querySelector('video')!.ended);
   assert.equal(await page.locator('video').evaluate(element=>(element as HTMLVideoElement).error),null);
  } finally { await browser.close(); }
  if(process.env.EDITOR_EXPORT_EVIDENCE_DIR) {
   await fs.mkdir(process.env.EDITOR_EXPORT_EVIDENCE_DIR,{recursive:true});
   await fs.copyFile(output,path.join(process.env.EDITOR_EXPORT_EVIDENCE_DIR,'task-6-synthetic-export.mp4'));
   await fs.writeFile(path.join(process.env.EDITOR_EXPORT_EVIDENCE_DIR,'task-6-synthetic-export-probe.json'),JSON.stringify(probe,null,2));
   await fs.writeFile(path.join(process.env.EDITOR_EXPORT_EVIDENCE_DIR,'task-6-audio-spectral.json'),JSON.stringify({cleanTones,contaminatedTones,maximumImportedRatio:.03},null,2));
  }
 } finally { await fs.rm(dir,{recursive:true,force:true}); }
});
