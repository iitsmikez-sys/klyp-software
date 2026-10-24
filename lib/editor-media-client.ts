import type { EditorAsset } from './editor-assets.ts';
import type { ClipEditDraftV3, VisualCutaway } from './clip-edit-draft.ts';
import { outputDuration, sourceAtOutputTime } from './editor-timeline.ts';

export type UploadPhase = 'preparing' | 'uploading' | 'verifying';
type UploadDependencies = {
 request: (path:string,init?:RequestInit)=>Promise<Response>; finalize: (path:string,init?:RequestInit)=>Promise<Response>;
 upload: (path:string, token:string, file:File, mime:string)=>Promise<void>;
};
const formats:Record<string,string[]> = {'image/jpeg':['jpg','jpeg'],'image/png':['png'],'image/webp':['webp'],'video/mp4':['mp4'],'video/quicktime':['mov'],'video/webm':['webm']};
export async function mediaResponse<T>(response:Response):Promise<T> {
 const data=await response.json().catch(()=>null);
 if(!response.ok)throw new Error(data?.error || 'Media service unavailable. Please retry.');
 if(!data)throw new Error('The media service returned an unreadable response. Please retry.');
 return data as T;
}
/** The app sees metadata only. Original bytes go directly to private storage. */
export async function uploadEditorFile(clipId:string,file:File,kind:'photo'|'video',progress:(phase:UploadPhase)=>void,deps:UploadDependencies):Promise<EditorAsset> {
 if(!Object.hasOwn(formats,file.type) || !formats[file.type].includes(file.name.split('.').pop()?.toLowerCase() || ''))throw new Error('Choose a supported photo or video file with a matching file type.');
 if((kind==='photo')!==file.type.startsWith('image/'))throw new Error(`Choose a ${kind} file.`);
 if(!file.size)throw new Error('Choose a nonempty file.');
 if(file.size>(kind==='photo'?10:50)*1024*1024)throw new Error(`${kind==='photo'?'Photos must be 10':'Videos must be 50'} MB or smaller.`);
 progress('preparing');
 const {asset,upload}=await mediaResponse<{asset:EditorAsset;upload:{path:string;token:string}}>(await deps.request(`/api/clips/${clipId}/media`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({file_name:file.name,size_bytes:file.size,mime_type:file.type})}));
 progress('uploading');await deps.upload(upload.path,upload.token,file,file.type);
 progress('verifying');
 const result=await mediaResponse<{asset:EditorAsset}>(await deps.finalize(`/api/clips/${clipId}/media/${asset.id}/finalize`,{method:'POST'}));
 if(result.asset.status!=='verified')throw new Error('Media verification did not finish. Please retry.');
 return result.asset;
}
// End positions are exclusive: at a ripple boundary use the preceding segment's end.
function sourceAtOutputEnd(draft:ClipEditDraftV3,seconds:number):number {
 let remaining=seconds;
 for(const s of draft.segments){const length=s.end_seconds-s.start_seconds;if(remaining<=length)return s.start_seconds+remaining;remaining-=length;}
 return draft.segments.at(-1)!.end_seconds;
}
export function updateCutawayInterval(draft:ClipEditDraftV3,cutaway:VisualCutaway,asset:EditorAsset,start:number,end:number,assetIn:number):VisualCutaway {
 if(asset.status!=='verified')throw new Error('Choose verified media.');
 if(![start,end,assetIn].every(Number.isFinite)||start<0||end>outputDuration(draft.segments)+1e-7||end-start<.1-1e-7||assetIn<0)throw new Error('Keep the cutaway inside the clip with at least 0.1 seconds of duration.');
 const next={...cutaway,source_start_ms:Math.round(sourceAtOutputTime(draft.segments,start)*1000),source_end_ms:Math.round(sourceAtOutputEnd(draft,end)*1000),asset_in_ms:asset.kind==='photo'?0:Math.round(assetIn*1000)};
 if(asset.kind==='video'&&(asset.duration_ms===null||next.asset_in_ms+next.source_end_ms-next.source_start_ms>asset.duration_ms))throw new Error('This interval extends beyond the imported video duration. Shorten it or reduce the media start.');
 if(draft.cutaways.some(c=>c.id!==next.id&&c.source_start_ms<next.source_end_ms&&c.source_end_ms>next.source_start_ms))throw new Error('Cutaways cannot overlap. Move or shorten the selected interval.');
 return next;
}
export function createCutawayAtPlayhead(draft:ClipEditDraftV3,asset:EditorAsset,time:number,id:string):VisualCutaway {
 if(draft.cutaways.length>=12)throw new Error('Keep at most 12 cutaways. Remove one before inserting more media.');
 const duration=outputDuration(draft.segments);
 if(!Number.isFinite(time)||time<0||time>=duration-.099999)throw new Error('Move the playhead before the end of the clip to insert media.');
 const sourceStart=sourceAtOutputTime(draft.segments,time)*1000;
 let end=Math.min(duration,time+(asset.kind==='photo'?3:(asset.duration_ms??0)/1000));
 if(asset.kind==='video') {
  const cap=sourceStart+(asset.duration_ms??0);let offset=0;end=time;
  for(const s of draft.segments){if(s.start_seconds*1000>=cap)break;end=offset+Math.min(s.end_seconds*1000,cap)/1000-s.start_seconds;offset+=s.end_seconds-s.start_seconds;if(s.end_seconds*1000>=cap)break;}
 }
 return updateCutawayInterval(draft,{id,asset_id:asset.id,source_start_ms:0,source_end_ms:0,asset_in_ms:0,fit:'cover',focal_point:{x:.5,y:.5}},asset,time,end,0);
}
/** Match FFmpeg's even square-pixel scale, crop/pad, and focal offsets. Use the
 * browser's videoWidth/videoHeight (display geometry), never coded asset metadata. */
export function cutawayDrawRect(sw:number,sh:number,w:number,h:number,fit:'cover'|'contain',focal:{x:number;y:number}) {
 const wide=sw/sh>=w/h, even=fit==='cover'?(n:number)=>Math.ceil(n/2)*2:(n:number)=>Math.max(2,Math.floor(n/2)*2);
 const dw=fit==='cover'?(wide?even(h*sw/sh):w):(wide?w:even(h*sw/sh));
 const dh=fit==='cover'?(wide?h:even(w*sh/sw)):(wide?even(w*sh/sw):h);
 return {x:(w-dw)*focal.x,y:(h-dh)*focal.y,w:dw,h:dh};
}
