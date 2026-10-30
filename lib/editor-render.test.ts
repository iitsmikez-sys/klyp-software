import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildKeptSegmentsFilter, buildKeptSegmentsWithInsertsFilter, renderKeptSegments, validateEditorExportRequest } from './editor-render.ts';

test('insert graph uses imported video audio unless muted and gives still images silence',()=>{
 const segments=[{id:'a',start_seconds:100,end_seconds:102},{id:'b',start_seconds:102,end_seconds:104}];
 const inserts=[{id:'video',asset_id:'v',after_segment_id:'a',duration_ms:1000,asset_in_ms:500,muted:false},{id:'photo',asset_id:'p',after_segment_id:'a',duration_ms:1000,asset_in_ms:0,muted:false}];
 const assets=[{id:'v',kind:'video' as const,localPath:'C:/v.mp4',mime_type:'video/mp4',width:640,height:360,duration_ms:3000},{id:'p',kind:'photo' as const,localPath:'C:/p.png',mime_type:'image/png',width:640,height:360,duration_ms:null}];
 const graph=buildKeptSegmentsWithInsertsFilter(100,segments,inserts,assets,true,[true,false],{w:640,h:360});
 assert.match(graph,/\[1:a:0\]atrim=start=0\.5:end=1\.5/);
 assert.match(graph,/concat=n=4:v=1:a=1/);
 assert.match(graph,/anullsrc/);
 assert.doesNotMatch(buildKeptSegmentsWithInsertsFilter(100,segments,[{...inserts[0],muted:true}],assets,true,[true,false],{w:640,h:360}),/\[1:a:0\]/);
});
test('real FFmpeg places an imported video and its audio between source sections',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'editor-insert-test-'));
 try{
  const source=path.join(dir,'source.mp4'),media=path.join(dir,'media.mp4'),output=path.join(dir,'output.mp4');
  await run(resolveBin('ffmpeg'),['-v','error','-f','lavfi','-i','color=c=red:s=64x64:r=30:d=2','-f','lavfi','-i','sine=frequency=440:duration=2','-shortest','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-y',source]);
  await run(resolveBin('ffmpeg'),['-v','error','-f','lavfi','-i','color=c=blue:s=64x64:r=30:d=1','-f','lavfi','-i','sine=frequency=880:duration=1','-shortest','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-y',media]);
  const parts=[{id:'a',start_seconds:100,end_seconds:101},{id:'b',start_seconds:101,end_seconds:102}];
  const items=[{id:'insert',asset_id:'asset',after_segment_id:'a',duration_ms:1000,asset_in_ms:0,muted:false}];
  const assets=[{id:'asset',localPath:media,kind:'video' as const,mime_type:'video/mp4',width:64,height:64,duration_ms:1000}];
  const result=await renderKeptSegments(source,100,parts,output,'off',{items,assets});
  assert.equal(result.duration,3);
  const info=JSON.parse(await runCapture(resolveBin('ffprobe'),['-v','error','-show_entries','format=duration','-of','json',output]));
  assert.ok(Math.abs(Number(info.format.duration)-3)<.15);
  for(const [time,color] of [[.5,'red'],[1.5,'blue'],[2.5,'red']] as const){
   const frame=path.join(dir,`${time}.rgb`);await run(resolveBin('ffmpeg'),['-v','error','-ss',String(time),'-i',output,'-frames:v','1','-vf','scale=1:1','-pix_fmt','rgb24','-f','rawvideo','-y',frame]);
   const pixel=await readFile(frame);assert.ok(color==='red'?pixel[0]>pixel[2]+100:pixel[2]>pixel[0]+100);
  }
  const pcm=path.join(dir,'audio.pcm');await run(resolveBin('ffmpeg'),['-v','error','-i',output,'-vn','-ar','48000','-ac','1','-f','s16le','-y',pcm]);const samples=await readFile(pcm);
  for(const [begin,frequency] of [[.2,440],[1.2,880],[2.2,440]]){let crossings=0,previous=0;for(let sample=Math.round(begin*48000);sample<Math.round((begin+.2)*48000);sample++){const value=samples.readInt16LE(sample*2);if(value>=0&&previous<0)crossings++;previous=value;}assert.ok(Math.abs(crossings/.2-frequency)<25,`Expected ${frequency} Hz at ${begin}s, got ${crossings/.2}`);}
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('real FFmpeg holds an inserted photo with silent audio when source has none',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'editor-photo-insert-'));try{
  const source=path.join(dir,'source.mp4'),photo=path.join(dir,'photo.png'),output=path.join(dir,'output.mp4');
  await run(resolveBin('ffmpeg'),['-v','error','-f','lavfi','-i','color=c=red:s=64x64:r=30:d=2','-c:v','libx264','-pix_fmt','yuv420p','-y',source]);
  await run(resolveBin('ffmpeg'),['-v','error','-f','lavfi','-i','color=c=yellow:s=64x64','-frames:v','1','-y',photo]);
  const parts=[{id:'a',start_seconds:100,end_seconds:101},{id:'b',start_seconds:101,end_seconds:102}];
  const items=[{id:'insert',asset_id:'asset',after_segment_id:'a',duration_ms:1000,asset_in_ms:0,muted:false}];
  await renderKeptSegments(source,100,parts,output,'off',{items,assets:[{id:'asset',localPath:photo,kind:'photo',mime_type:'image/png',width:64,height:64,duration_ms:null}]});
  const frame=path.join(dir,'frame.rgb');await run(resolveBin('ffmpeg'),['-v','error','-ss','1.5','-i',output,'-frames:v','1','-vf','scale=1:1','-pix_fmt','rgb24','-f','rawvideo','-y',frame]);
  const pixel=await readFile(frame);assert.ok(pixel[0]>150&&pixel[1]>150&&pixel[2]<80);
 }finally{await rm(dir,{recursive:true,force:true});}
});
import { resolveBin, run, runCapture } from './bin.ts';
const segments = [{id:'a',start_seconds:101,end_seconds:101.5},{id:'b',start_seconds:103,end_seconds:103.5}];
const clip = {id:'owned',url:'https://twitch.tv/videos/1',start_seconds:100,end_seconds:104,words:null,edit_draft:null};
const draft = {version:2,start_seconds:101,end_seconds:103.5,title:'Cut',hook:'',hook_style:'IMPACT',caption_style:'BOLD',aspect_ratio:'9:16',words:null,segments,caption_cues:null,caption_color:'white',caption_position:'bottom'};
test('filter uses relative source offsets, resets each stream, and concatenates paired audio', () => {
 const filter=buildKeptSegmentsFilter(100,segments,true);
 assert.match(filter,/trim=start=1:end=1.5,setpts=PTS-STARTPTS/);
 assert.match(filter,/atrim=start=3:end=3.5,asetpts=PTS-STARTPTS/);
 assert.match(filter,/\[v0\]\[a0\]\[v1\]\[a1\]concat=n=2:v=1:a=1\[video\]\[audio\]/);
 assert.doesNotMatch(buildKeptSegmentsFilter(100,segments,false),/atrim|\[audio\]/);
});
test('validates supplied/saved drafts against the owned original and requires a matching clip', () => {
 assert.equal(validateEditorExportRequest({clip_id:'owned',edit_draft:draft},clip)?.version,2);
 assert.equal(validateEditorExportRequest({clip_id:'owned',editor_export:true},{...clip,edit_draft:draft})?.version,2);
 assert.throws(()=>validateEditorExportRequest({clip_id:'other',edit_draft:draft},clip),/owned/i);
 assert.throws(()=>validateEditorExportRequest({clip_id:'owned',edit_draft:{...draft,segments:[{id:'x',start_seconds:0,end_seconds:1}]}},clip),/segments/i);
 assert.throws(()=>validateEditorExportRequest({clip_id:'owned',segments},clip),/draft/i);
 assert.equal(validateEditorExportRequest({clip_id:'owned'},clip),null);
});
for (const audio of [true,false]) test(`real FFmpeg keeps frames and tones in order (audio=${audio})`,async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'editor-render-test-'));
 try {
 const source=path.join(dir,'source.mp4'),output=path.join(dir,'output.mp4');
 await run(resolveBin('ffmpeg'),['-v','error','-f','lavfi','-i','color=c=red:s=64x64:r=20:d=2','-f','lavfi','-i','color=c=blue:s=64x64:r=20:d=2',...(audio?['-f','lavfi','-i','sine=frequency=440:duration=2:sample_rate=48000','-f','lavfi','-i','sine=frequency=880:duration=2:sample_rate=48000']:[]),'-filter_complex',audio?'[0:v][2:a][1:v][3:a]concat=n=2:v=1:a=1[v][a]':'[0:v][1:v]concat=n=2:v=1:a=0[v]','-map','[v]',...(audio?['-map','[a]']:[]),'-c:v','libx264','-threads','2','-pix_fmt','yuv420p','-y',source]);
 const result=await renderKeptSegments(source,100,segments,output);
 assert.deepEqual(result,{duration:1,hasAudio:audio});
 const info=JSON.parse(await runCapture(resolveBin('ffprobe'),['-v','error','-show_format','-show_streams','-of','json',output]));
 assert.ok(Math.abs(Number(info.format.duration)-1)<0.08);
 assert.equal(info.streams.some((s:{codec_type:string})=>s.codec_type==='audio'),audio);
 for(const [time,color] of [[0.2,'red'],[0.7,'blue']] as const){
 const frame=path.join(dir,`${color}.rgb`);
 await run(resolveBin('ffmpeg'),['-v','error','-ss',String(time),'-i',output,'-frames:v','1','-vf','scale=1:1','-pix_fmt','rgb24','-f','rawvideo','-y',frame]);
 const pixel=await readFile(frame); assert.ok(color==='red'?pixel[0]>pixel[2]+100:pixel[2]>pixel[0]+100);
 }
 if(audio){const pcm=path.join(dir,'audio.pcm');await run(resolveBin('ffmpeg'),['-v','error','-i',output,'-vn','-ar','48000','-ac','1','-f','s16le','-y',pcm]);const data=await readFile(pcm);
 for(const [begin,freq] of [[0.1,440],[0.6,880]]){let crossings=0;let prev=0;for(let i=Math.round(begin*48000);i<Math.round((begin+0.2)*48000);i++){const value=data.readInt16LE(i*2);if(value>=0&&prev<0)crossings++;prev=value;}assert.ok(Math.abs(crossings/0.2-freq)<20,`tone ${crossings/0.2}, expected ${freq}`);}}
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('explicit null draft is rejected rather than silently exporting a saved draft',()=>{
 assert.throws(()=>validateEditorExportRequest({clip_id:'owned',edit_draft:null},{...clip,edit_draft:draft}),/draft/i);
});
test('V3 exports without cutaways retain the complete validated draft', () => {
 const v3 = { ...draft, version: 3, cutaways: [] };
 assert.deepEqual(validateEditorExportRequest({ clip_id: 'owned', edit_draft: v3 }, clip), { ...v3, caption_font: 'sans', audio_polish: 'off' });
 assert.deepEqual(validateEditorExportRequest({ clip_id: 'owned', editor_export: true }, { ...clip, edit_draft: v3 }), { ...v3, caption_font: 'sans', audio_polish: 'off' });
});
test('V3 cutaways are retained for normal export and rejected for raw export', () => {
 const v3 = { ...draft, version: 3, cutaways: [{ id: 'visual', asset_id: 'asset', source_start_ms: 101000, source_end_ms: 101500, asset_in_ms: 0, fit: 'cover', focal_point: { x: 0.5, y: 0.5 } }] };
 assert.deepEqual(validateEditorExportRequest({ clip_id: 'owned', edit_draft: v3 }, clip), { ...v3, caption_font: 'sans', audio_polish: 'off' });
 assert.throws(() => validateEditorExportRequest({ clip_id: 'owned', edit_draft: v3, raw: true }, clip), /normal export/i);
});
