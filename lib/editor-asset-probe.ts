import { createWriteStream } from 'node:fs';
import { mkdtemp, open, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { resolveBin, run, runCapture, isProcessInfrastructureError } from './bin.ts';
import { createAdminClient } from './supabase/admin.ts';
import { EDITOR_MEDIA_BUCKET, PHOTO_MAX_BYTES, VIDEO_MAX_BYTES, EditorAssetError, validateEditorAssetMetadata, type EditorAsset, type EditorAssetMetadata } from './editor-assets.ts';
import { editorAssetStoreError } from './editor-assets-store.ts';

/** Presentation extent of the selected visual stream, independent of audio/container length. */
export function visualPacketDurationMs(packets: {pts_time?:string;duration_time?:string}[]):number {
 if(!packets.length) throw new EditorAssetError('The video has no readable visual duration.');
 let start=Infinity,end=-Infinity;
 for(const packet of packets) {
  const pts=Number(packet.pts_time),duration=Number(packet.duration_time);
  if(!Number.isFinite(pts)||!Number.isFinite(duration)||duration<=0) throw new EditorAssetError('The video has missing presentation timestamps or frame duration. Choose a different video.');
  start=Math.min(start,pts);end=Math.max(end,pts+duration);
 }
 // Floor avoids advertising even a fraction of a millisecond beyond available picture.
 return Math.floor((end-start)*1000+1e-6);
}

/** Local bounded file only. Never let an untrusted container resolve network URLs or other files. */
export async function probeEditorAssetFile(file: string, kind:'photo'|'video', mime: string):Promise<EditorAssetMetadata> {
 const size = (await stat(file)).size;
 if (size > (kind==='photo' ? PHOTO_MAX_BYTES : VIDEO_MAX_BYTES)) throw new EditorAssetError(kind==='photo'?'Photos must be 10 MB or smaller.':'Videos must be 50 MB or smaller.',413);
 const handle = await open(file,'r'); const bytes=Buffer.alloc(4096);
 try { await handle.read(bytes,0,bytes.length,0); } finally { await handle.close(); }
 let actual:string, demuxer:string;
 if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) { actual='image/png'; demuxer='png_pipe'; }
 else if(bytes[0]===255 && bytes[1]===216 && bytes[2]===255) { actual='image/jpeg'; demuxer='jpeg_pipe'; }
 else if(bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP') { actual='image/webp'; demuxer='webp_pipe'; }
 else if(bytes.toString('ascii',4,8)==='ftyp') { actual=bytes.toString('ascii',8,12)==='qt  '?'video/quicktime':'video/mp4'; demuxer='mov'; }
 else if(bytes.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]))) { actual='video/webm'; demuxer='matroska'; }
 else throw new EditorAssetError('The uploaded file is not a valid supported media format.');
 if(actual!==mime || (kind==='photo')!==actual.startsWith('image/')) throw new EditorAssetError('The actual media format does not match the upload.');
 const input=['-protocol_whitelist','file,pipe','-f',demuxer,'-i',file];
 try {
  const info=JSON.parse(await runCapture(resolveBin('ffprobe'),['-v','error',...input,'-show_streams','-show_format','-of','json'],{maxRunMs:15000}));
  const stream=info.streams?.find((s:{codec_type?:string;disposition?:{attached_pic?:number}})=>s.codec_type==='video' && !s.disposition?.attached_pic);
  if(!stream) throw new EditorAssetError('Choose a file with a decodable visual video or image stream.');
  if(actual==='video/webm') {
   // WebM uses the Matroska demuxer, but requires its own DocType and video codecs.
   const docType=bytes.indexOf(Buffer.from([0x42,0x82]));
   let cursor=docType+2, marker=0x80, lengthBytes=1;
   while(marker && !(bytes[cursor]&marker)) { marker>>=1; lengthBytes++; }
   let length=bytes[cursor] & (marker-1);
   for(let i=1;i<lengthBytes;i++) length=length*256+bytes[cursor+i];
   cursor+=lengthBytes;
   if(docType<0 || !marker || length!==4 || bytes.toString('ascii',cursor,cursor+4)!=='webm' || !['vp8','vp9','av1'].includes(stream.codec_name)) throw new EditorAssetError('Choose a valid WebM video, or upload this file as a supported MP4 or MOV.');
  }
  if(kind==='photo' && Number(stream.nb_frames || 1)>1) throw new EditorAssetError('Choose a still photo; animated images are not supported.');
  let duration:number|null=null;
  if(kind==='video') {
   const streamDuration=Number(stream.duration);
   if(Number.isFinite(streamDuration)&&streamDuration>0) duration=Math.floor(streamDuration*1000+1e-6);
   else {
    // WebM commonly has no stream duration. Inspect only this stream's presentation
    // packets; container duration and audio duration cannot establish picture length.
    // Use a file because the process runner deliberately caps diagnostic stdout.
    const dir=await mkdtemp(path.join(tmpdir(),'klyp-visual-timing-'));
    try {
     const output=path.join(dir,'packets.json');
     await run(resolveBin('ffprobe'),['-v','error',...input,'-select_streams',String(stream.index),'-show_entries','packet=pts_time,duration_time','-of','json','-o',output],{maxRunMs:15000});
     duration=visualPacketDurationMs(JSON.parse(await readFile(output,'utf8')).packets||[]);
    } finally {await rm(dir,{recursive:true,force:true});}
   }
  }
  const rotation=Number(stream.side_data_list?.find((s:{rotation?:number})=>s.rotation!==undefined)?.rotation || 0);
  const rotated=Math.abs(rotation)%180===90;
  const metadata=validateEditorAssetMetadata({kind,mime_type:actual,size_bytes:size,width:Number(rotated?stream.height:stream.width),height:Number(rotated?stream.width:stream.height),duration_ms:duration},kind);
  // Probe headers alone do not establish decodability. Decode the complete bounded visual stream.
  await run(resolveBin('ffmpeg'),['-v','error','-xerror','-err_detect','explode','-threads','2',...input,'-map',`0:${stream.index}`,'-an','-sn','-dn','-threads','2','-f','null','-'],{maxRunMs:90000});
  return metadata;
 } catch(error) {
  if(error instanceof EditorAssetError) throw error;
  if(isProcessInfrastructureError(error)) throw new EditorAssetError('Media verification is temporarily unavailable on the processing service. Please retry verification in a moment.',503);
  throw new EditorAssetError('The uploaded file cannot be decoded. Choose a valid photo or video and upload it again.');
 }
}

/** Runs only on Railway; original remains durable in Supabase, local file is disposable. */
export async function probeStoredEditorAsset(asset: EditorAsset):Promise<EditorAssetMetadata> {
 if(process.env.DEPLOYMENT_TARGET!=='processing') throw new EditorAssetError('Finalize this upload on the processing service.',503);
 const bucket=createAdminClient().storage.from(EDITOR_MEDIA_BUCKET);
 const {data,error}=await bucket.createSignedUrl(asset.storage_path,180);
 if(error) throw editorAssetStoreError(error);
 const dir=await mkdtemp(path.join(tmpdir(),'klyp-editor-media-'));
 try {
  const response=await fetch(data!.signedUrl,{signal:AbortSignal.timeout(45000),redirect:'error'});
  if(response.status===404) throw new EditorAssetError('The uploaded file is missing. Upload it again.',404);
  if(!response.ok || !response.body) throw new EditorAssetError('Could not read the uploaded file. Please retry verification.',503);
  const file=path.join(dir,'source'); let received=0;
  const cap=asset.kind==='photo'?PHOTO_MAX_BYTES:VIDEO_MAX_BYTES;
  const source=Readable.fromWeb(response.body as import('node:stream/web').ReadableStream);
  await pipeline(async function*(){ for await(const chunk of source) { received+=(chunk as Buffer).length; if(received>cap) throw new EditorAssetError(asset.kind==='photo'?'Photos must be 10 MB or smaller.':'Videos must be 50 MB or smaller.',413); yield chunk; } },createWriteStream(file));
  return await probeEditorAssetFile(file,asset.kind,asset.declared_mime);
 } finally { await rm(dir,{recursive:true,force:true}); }
}
