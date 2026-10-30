import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ClipEditDraftV3 } from './clip-edit-draft.ts';
import type { ResolvedCutawaySpan } from './editor-timeline.ts';
import { assertOwnedDraftAssets, getOwnedEditorAsset, validateEditorAssetMetadata, EDITOR_MEDIA_BUCKET, EditorAssetError, type EditorAsset } from './editor-assets.ts';

/** Only server-materialized, verified originals may populate the additional inputs. */
export type RenderableEditorAsset = {
 id: string; localPath: string; kind: 'photo' | 'video'; mime_type: string;
 width: number; height: number; duration_ms: number | null;
};
const demuxers: Record<string,string> = {
 'image/png':'png_pipe', 'image/jpeg':'jpeg_pipe', 'image/webp':'webp_pipe',
 'video/mp4':'mov', 'video/quicktime':'mov', 'video/webm':'matroska',
};

/** Force the verified container and disallow network protocols when decoding uploads. */
export function cutawayInputArgs(assets: readonly RenderableEditorAsset[]): string[] {
 return assets.flatMap(asset => {
  if (!path.isAbsolute(asset.localPath) || !demuxers[asset.mime_type]) throw new RangeError('Invalid local media asset.');
  return ['-threads','2','-protocol_whitelist','file,pipe','-f',demuxers[asset.mime_type],'-i',asset.localPath];
 });
}

/** Inputs 1..N correspond to assets, with source video/audio remaining input 0. */
export function buildCutawayGraph(
 baseVideoLabel: string,
 spans: readonly ResolvedCutawaySpan[],
 assets: readonly RenderableEditorAsset[],
 dimensions: {w:number;h:number},
): {filter:string;videoLabel:string} {
 if (!spans.length) return {filter:'',videoLabel:baseVideoLabel};
 const {w,h}=dimensions;
 if (![w,h].every(n=>Number.isInteger(n)&&n>0)) throw new RangeError('Invalid output dimensions.');
 const filters:string[]=[];
 let current=baseVideoLabel, previousEnd=0;
 spans.forEach((span,index)=>{
  const input=assets.findIndex(asset=>asset.id===span.asset_id), asset=assets[input];
  if (!asset) throw new RangeError('A cutaway media asset is missing.');
  const start=span.start_ms/1000, end=span.end_ms/1000, duration=end-start, offset=span.asset_in_ms/1000;
  if (![start,end,offset].every(Number.isFinite) || start<previousEnd || duration<=0 || offset<0) throw new RangeError('Invalid cutaway timing.');
  previousEnd=end;
  const {x,y}=span.focal_point;
  if (![x,y].every(n=>Number.isFinite(n)&&n>=0&&n<=1) || !['cover','contain'].includes(span.fit)) throw new RangeError('Invalid cutaway fit.');
  if (asset.kind==='video' && (asset.duration_ms===null || span.asset_in_ms+span.end_ms-span.start_ms>asset.duration_ms)) throw new RangeError('Cutaway exceeds imported video duration.');
  const box=span.placement==='overlay'?span.rect:null;
  if(span.placement==='overlay'&&(!box||![box.x,box.y,box.w,box.h].every(Number.isFinite)||box.w<.05||box.h<.05||box.x<0||box.y<0||box.x+box.w>1.00001||box.y+box.h>1.00001))throw new RangeError('Invalid overlay rectangle.');
  const targetW=box?Math.max(2,Math.round(w*box.w/2)*2):w,targetH=box?Math.max(2,Math.round(h*box.h/2)*2):h;
  const targetX=box?Math.round(w*box.x):0,targetY=box?Math.round(h*box.y):0;
  const timing=asset.kind==='photo'
   ? `loop=loop=-1:size=1:start=0,setpts=N/(30*TB),trim=duration=${duration}`
   : `trim=start=${offset}:end=${offset+duration},setpts=PTS-STARTPTS,fps=30`;
  // dar includes the decoded frame's pixel aspect ratio (and FFmpeg autorotation).
  // Size square-pixel output directly from display geometry before crop/pad. Using
  // force_original_aspect_ratio here would fit coded dimensions and distort SAR != 1.
  const framing=span.fit==='cover'
   ? `scale=w='if(gte(dar,${targetW}/${targetH}),ceil(${targetH}*dar/2)*2,${targetW})':h='if(gte(dar,${targetW}/${targetH}),${targetH},ceil(${targetW}/dar/2)*2)',setsar=1,crop=${targetW}:${targetH}:(iw-ow)*${x}:(ih-oh)*${y}`
   : `scale=w='if(gte(dar,${targetW}/${targetH}),${targetW},max(2,floor(${targetH}*dar/2)*2))':h='if(gte(dar,${targetW}/${targetH}),max(2,floor(${targetW}/dar/2)*2),${targetH})',setsar=1,pad=${targetW}:${targetH}:(ow-iw)*${x}:(oh-ih)*${y}:color=black`;
  // V excludes attached cover artwork, matching the stream selected during verification.
  // Resize stills before the looping filter retains a frame, bounding its memory by output size.
  filters.push(`[${input+1}:V:0]${asset.kind==='photo' ? `${framing},${timing}` : `${timing},${framing}`},setsar=1${box?`,setpts=PTS-STARTPTS+${start}/TB`:''}[cutmedia${index}]`);
  if(box){
   const next=`cutout${index}`;
   filters.push(`[${current}][cutmedia${index}]overlay=x=${targetX}:y=${targetY}:eof_action=pass:repeatlast=0:enable='gte(t,${start})*lt(t,${end})'[${next}]`);
   current=next;return;
  }
  // Flatten transparency/letterboxing against an opaque canvas, fully replacing source picture.
  filters.push(`color=c=black:s=${w}x${h}:r=30:d=${duration}[cutbg${index}]`);
  filters.push(`[cutbg${index}][cutmedia${index}]overlay=shortest=1:format=auto,format=yuv420p,setpts=PTS-STARTPTS+${start}/TB[cutpixels${index}]`);
  const next=`cutout${index}`;
  filters.push(`[${current}][cutpixels${index}]overlay=eof_action=pass:repeatlast=0:enable='gte(t,${start})*lt(t,${end})'[${next}]`);
  current=next;
 });
 return {filter:filters.join(';'),videoLabel:current};
}

/** Mix explicitly enabled overlay-video audio with the source without shifting its timeline. */
export function buildOverlayAudioGraph(
 spans: readonly ResolvedCutawaySpan[], assets: readonly RenderableEditorAsset[],
 assetHasAudio: readonly boolean[], hasSourceAudio: boolean, duration: number,
): {filter:string;audioLabel:string|null} {
 if(!Number.isFinite(duration)||duration<=0||duration>180)throw new RangeError('Invalid audio duration.');
 const active=spans.filter(span=>span.placement==='overlay'&&span.muted===false);
 const filters:string[]=[],inputs:string[]=[];
 for(const [index,span] of active.entries()){
  const assetIndex=assets.findIndex(asset=>asset.id===span.asset_id),asset=assets[assetIndex];
  if(!asset)throw new RangeError('An overlay audio asset is missing.');
  if(asset.kind!=='video'||!assetHasAudio[assetIndex])continue;
  const start=span.start_ms/1000,end=span.end_ms/1000,from=span.asset_in_ms/1000;
  if(start<0||end>duration+.05||end<=start||from<0)throw new RangeError('Invalid overlay audio timing.');
  filters.push(`[${assetIndex+1}:a:0]atrim=start=${from}:end=${from+end-start},asetpts=PTS-STARTPTS,adelay=delays=${Math.round(start*1000)}:all=1[overlayaudio${index}]`);
  inputs.push(`[overlayaudio${index}]`);
 }
 if(!inputs.length)return {filter:'',audioLabel:null};
 if(hasSourceAudio)filters.unshift('[0:a:0]asetpts=PTS-STARTPTS[baseaudio]');
 else filters.unshift(`anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=${duration}[baseaudio]`);
 filters.push(`[baseaudio]${inputs.join('')}amix=inputs=${inputs.length+1}:duration=first:normalize=0:dropout_transition=0,alimiter=limit=0.95[exportaudio]`);
 return {filter:filters.join(';'),audioLabel:'exportaudio'};
}

type AssetDownloadDependencies = {
 validate(userId:string,clipId:string,draft:ClipEditDraftV3):Promise<void>;
 owned(userId:string,clipId:string,assetId:string):Promise<EditorAsset>;
 download(asset:EditorAsset):Promise<Response>;
};
const downloadDependencies: AssetDownloadDependencies = {
 validate:assertOwnedDraftAssets,
 owned:getOwnedEditorAsset,
 async download(asset) {
  const [{createAdminClient},{editorAssetStoreError}]=await Promise.all([import('./supabase/admin.ts'),import('./editor-assets-store.ts')]);
  const {data,error}=await createAdminClient().storage.from(EDITOR_MEDIA_BUCKET).createSignedUrl(asset.storage_path,180);
  if(error) throw editorAssetStoreError(error);
  return fetch(data!.signedUrl,{signal:AbortSignal.timeout(45000),redirect:'error'});
 },
};

/** Download immutable, owned originals into the caller's disposable export directory. */
export async function loadEditorCutawayAssets(
 userId:string,clipId:string,draft:ClipEditDraftV3,directory:string,
 dependencies:AssetDownloadDependencies=downloadDependencies,
):Promise<RenderableEditorAsset[]> {
 await dependencies.validate(userId,clipId,draft);
 const assets:RenderableEditorAsset[]=[];
 try {
  for(const id of Array.from(new Set([...draft.cutaways.map(c=>c.asset_id),...(draft.inserts??[]).map(c=>c.asset_id)]))) {
   const asset=await dependencies.owned(userId,clipId,id);
   if(asset.id!==id || asset.user_id!==userId || asset.clip_id!==clipId || asset.status!=='verified') throw new EditorAssetError('A verified owned media asset is required.',404);
   const metadata=validateEditorAssetMetadata({kind:asset.kind,mime_type:asset.mime_type!,size_bytes:asset.size_bytes!,width:asset.width!,height:asset.height!,duration_ms:asset.duration_ms},asset.kind);
   // Sequential bounded streaming avoids buffering up to 12 uploads in process memory.
   const response=await dependencies.download(asset);
   if(response.status===404) throw new EditorAssetError('The imported media file is missing. Upload it again.',404);
   if(!response.ok || !response.body) throw new EditorAssetError('Could not download imported media. Please retry export.',503);
   const localPath=path.join(directory,`cutaway-${assets.length}.media`);
   const source=Readable.fromWeb(response.body as import('node:stream/web').ReadableStream);
   let received=0;
   try {
    await pipeline(async function*(){for await(const chunk of source){received+=(chunk as Buffer).length;if(received>metadata.size_bytes)throw new EditorAssetError('Imported media size no longer matches its verified original. Upload it again.');yield chunk;}},createWriteStream(localPath));
    if(received!==metadata.size_bytes) throw new EditorAssetError('Imported media download is incomplete. Please retry export.',503);
   } catch(error) {await rm(localPath,{force:true});throw error;}
   assets.push({id,localPath,kind:asset.kind,mime_type:metadata.mime_type,width:metadata.width,height:metadata.height,duration_ms:metadata.duration_ms});
  }
  return assets;
 } catch(error) {
  await Promise.all(assets.map(asset=>rm(asset.localPath,{force:true})));
  throw error;
 }
}
