import { resolveBin, run, runCapture, FFMPEG_THREADS } from "./bin.ts";
import { validateClipEditDraft, type AudioPolish, type ClipEditDraftV2, type ClipEditDraftV3, type TimelineInsert } from "./clip-edit-draft.ts";
import { outputDuration, validateSegments, type SourceSegment } from "./editor-timeline.ts";
import { cutawayInputArgs, type RenderableEditorAsset } from './editor-cutaway-render.ts';
import type { SavedClip } from "./clip-ui.ts";

type OwnedEditorClip = Pick<SavedClip, "id" | "url" | "start_seconds" | "end_seconds" | "words" | "edit_draft">;

/** Legacy exports opt out; explicit editor requests require a valid owned timeline draft. */
export function validateEditorExportRequest(
  body: Record<string, unknown>,
  ownedClip: OwnedEditorClip | null,
): ClipEditDraftV2 | ClipEditDraftV3 | null {
  const requested = body.edit_draft !== undefined || body.editor_export === true ||
    body.segments !== undefined || body.caption_cues !== undefined;
  if (!requested) return null;
  if (!ownedClip || body.clip_id !== ownedClip.id) {
    throw new RangeError("An owned clip is required for editor export.");
  }
  if (body.edit_draft === undefined && body.editor_export !== true) {
    throw new RangeError("A complete editor draft is required.");
  }
  const draft = validateClipEditDraft(
    body.edit_draft !== undefined ? body.edit_draft : ownedClip.edit_draft, ownedClip,
  );
  if (draft.version === 1) throw new RangeError("A version 2 or 3 editor draft is required.");
  if (body.raw === true && draft.version === 3 && (draft.cutaways.length || draft.inserts?.length)) throw new RangeError("Raw export omits editor effects. Use normal export to include imported media.");
  return draft;
}

export function buildKeptSegmentsFilter(
  sourceOffsetSeconds: number,
  segments: readonly SourceSegment[],
  hasAudio: boolean,
  audioPolish: AudioPolish = "off",
): string {
  if (!Number.isFinite(sourceOffsetSeconds) || sourceOffsetSeconds < 0) {
    throw new RangeError("Invalid source offset.");
  }
  const checked = validateSegments(segments, sourceOffsetSeconds, Infinity);
  const filters: string[] = [];
  checked.forEach((segment, index) => {
    const start = segment.start_seconds - sourceOffsetSeconds;
    const end = segment.end_seconds - sourceOffsetSeconds;
    filters.push(`[0:v:0]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v${index}]`);
    if (hasAudio) filters.push(`[0:a:0]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${index}]`);
  });
  const inputs = checked.map((_, index) => `[v${index}]${hasAudio ? `[a${index}]` : ""}`).join("");
  filters.push(`${inputs}concat=n=${checked.length}:v=1:a=${hasAudio ? 1 : 0}[video]${hasAudio ? "[audio]" : ""}`);
  if (hasAudio && audioPolish === "voice") filters.push("[audio]highpass=f=80,lowpass=f=12000,acompressor=threshold=0.125:ratio=2:attack=15:release=180,alimiter=limit=0.95[audio_polished]");
  return filters.join(";");
}

/** Source sections and verified imported media share a continuous audio/video clock. */
export function buildKeptSegmentsWithInsertsFilter(
 sourceOffsetSeconds:number,segments:readonly SourceSegment[],inserts:readonly TimelineInsert[],
 assets:readonly RenderableEditorAsset[],sourceHasAudio:boolean,assetHasAudio:readonly boolean[],size:{w:number;h:number},audioPolish:AudioPolish='off',
):string {
 if(!Number.isFinite(sourceOffsetSeconds)||sourceOffsetSeconds<0||!Number.isInteger(size.w)||!Number.isInteger(size.h)||size.w<2||size.h<2)throw new RangeError('Invalid media dimensions.');
 validateSegments(segments,sourceOffsetSeconds,Infinity);
 const filters:string[]=[],labels:string[]=[];let index=0;
 const audio=(input:number,start:number,end:number,enabled:boolean,name:string)=>{
  if(enabled)filters.push(`[${input}:a:0]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo[a${name}]`);
  else filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${end-start},asetpts=PTS-STARTPTS[a${name}]`);
 };
 const frame=`scale=${size.w}:${size.h}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${size.w}:${size.h}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p`;
 for(const segment of segments){
  const name=String(index++),start=segment.start_seconds-sourceOffsetSeconds,end=segment.end_seconds-sourceOffsetSeconds;
  filters.push(`[0:v:0]trim=start=${start}:end=${end},setpts=PTS-STARTPTS,fps=30,${frame}[v${name}]`);
  audio(0,start,end,sourceHasAudio,name);labels.push(`[v${name}][a${name}]`);
  for(const insert of inserts){if(insert.after_segment_id!==segment.id)continue;
   const assetIndex=assets.findIndex(item=>item.id===insert.asset_id),asset=assets[assetIndex];if(!asset)throw new RangeError('Inserted media asset missing.');
   const from=insert.asset_in_ms/1000,to=from+insert.duration_ms/1000;const id=String(index++),input=assetIndex+1;
   if(asset.kind==='video'){
    if(asset.duration_ms===null||insert.asset_in_ms+insert.duration_ms>asset.duration_ms)throw new RangeError('Inserted video exceeds its verified duration.');
    filters.push(`[${input}:V:0]trim=start=${from}:end=${to},setpts=PTS-STARTPTS,fps=30,${frame}[v${id}]`);
    audio(input,from,to,assetHasAudio[assetIndex]===true&&!insert.muted,id);
   }else{
    if(insert.asset_in_ms!==0)throw new RangeError('Photo insertion must start at zero.');
    filters.push(`[${input}:V:0]${frame},loop=loop=-1:size=1:start=0,trim=duration=${to},setpts=N/(30*TB),fps=30[v${id}]`);
    audio(input,0,to,false,id);
   }
   labels.push(`[v${id}][a${id}]`);
  }
 }
 filters.push(`${labels.join('')}concat=n=${labels.length}:v=1:a=1[video][audio]`);
 if(audioPolish==='voice')filters.push('[audio]highpass=f=80,lowpass=f=12000,acompressor=threshold=0.125:ratio=2:attack=15:release=180,alimiter=limit=0.95[audio_polished]');
 return filters.join(';');
}

/** Render a continuous intermediate with source audio, preserving native framing for the final pipeline. */
export async function renderKeptSegments(
  sourcePath: string,
  sourceOffsetSeconds: number,
  segments: readonly SourceSegment[],
  outputPath: string,
  audioPolish: AudioPolish = "off",
  inserted?:{items:readonly TimelineInsert[];assets:readonly RenderableEditorAsset[]},
): Promise<{ duration: number; hasAudio: boolean }> {
  const probe = JSON.parse(await runCapture(resolveBin("ffprobe"), [
    "-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", sourcePath,
  ], { maxRunMs: 30_000 }));
  const duration = Number(probe.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new RangeError("Source duration could not be read.");
  // Container duration can differ from the final video frame by a small rounding interval.
  validateSegments(segments, sourceOffsetSeconds, sourceOffsetSeconds + duration + 0.05);
  const hasAudio = probe.streams.some((stream: { codec_type: string }) => stream.codec_type === "audio");
  if(inserted?.items.length){
   const sizeProbe=JSON.parse(await runCapture(resolveBin('ffprobe'),['-v','error','-select_streams','v:0','-show_entries','stream=width,height','-of','json',sourcePath],{maxRunMs:30000}));
   const width=Number(sizeProbe.streams?.[0]?.width),height=Number(sizeProbe.streams?.[0]?.height);
   const assetHasAudio=await Promise.all(inserted.assets.map(async asset=>asset.kind==='video' ? JSON.parse(await runCapture(resolveBin('ffprobe'),['-v','error','-select_streams','a:0','-show_entries','stream=codec_type','-of','json',asset.localPath],{maxRunMs:30000})).streams?.length>0 : false));
   const filter=buildKeptSegmentsWithInsertsFilter(sourceOffsetSeconds,segments,inserted.items,inserted.assets,hasAudio,assetHasAudio,{w:width,h:height},audioPolish);
   await run(resolveBin('ffmpeg'),['-i',sourcePath,...cutawayInputArgs(inserted.assets),'-filter_complex_threads',String(FFMPEG_THREADS),'-filter_complex',filter,'-map','[video]','-map',audioPolish==='voice'?'[audio_polished]':'[audio]','-c:v','libx264','-preset','veryfast','-crf','18','-threads',String(FFMPEG_THREADS),'-c:a','aac','-b:a','192k','-movflags','+faststart','-y',outputPath],{stallTimeoutMs:30000,maxRunMs:10*60_000});
   return {duration:outputDuration(segments)+inserted.items.reduce((sum,item)=>sum+item.duration_ms/1000,0),hasAudio:true};
  }
  const filter = buildKeptSegmentsFilter(sourceOffsetSeconds, segments, hasAudio, audioPolish);
  await run(resolveBin("ffmpeg"), [
    "-i", sourcePath,
    "-filter_complex_threads", String(FFMPEG_THREADS), "-filter_complex", filter,
    "-map", "[video]", ...(hasAudio ? ["-map", audioPolish === "voice" ? "[audio_polished]" : "[audio]"] : []),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-threads", String(FFMPEG_THREADS),
    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-y", outputPath,
  ], { stallTimeoutMs: 30_000, maxRunMs: 10 * 60_000 });
  return { duration: outputDuration(segments), hasAudio };
}
