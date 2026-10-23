import { outputDuration, sourceAtOutputTime, type SourceSegment } from './editor-timeline.ts';
export function seekEditedVideo(video: { currentTime: number }, segments: readonly SourceSegment[], seconds: number, previewStart = segments[0]?.start_seconds ?? 0) {
 video.currentTime = sourceAtOutputTime(segments, seconds) - previewStart;
}
export function nextPlaybackPosition(segments: readonly SourceSegment[], sourceSeconds: number) {
 let output = 0;
 for (const segment of segments) {
  if (sourceSeconds < segment.end_seconds) {
   const source = Math.max(sourceSeconds, segment.start_seconds);
   return { sourceSeconds: source, outputSeconds: output + source - segment.start_seconds, ended: false };
  }
  output += segment.end_seconds - segment.start_seconds;
 }
 return { sourceSeconds: segments.at(-1)?.end_seconds ?? 0, outputSeconds: output, ended: true };
}
export function thumbnailTimes(segments: readonly SourceSegment[], count: number) {
 const duration = outputDuration(segments);
 return Array.from({length: Math.max(0, Math.min(120, Math.floor(count)))}, (_, i) => sourceAtOutputTime(segments, duration * i / count));
}
export function audioPeaks(samples: Float32Array | null, count: number): number[] | null {
 if (!samples?.length || count <= 0) return null;
 const length = Math.min(count, samples.length);
 const peaks = Array.from({length}, (_, i) => {
  let peak = 0;
  for (let j = Math.floor(i * samples.length / length); j < Math.floor((i + 1) * samples.length / length); j++) peak = Math.max(peak, Math.abs(samples[j]));
  return peak;
 });
 return peaks.some(p => p > .00001) ? peaks : null;
}
export function timeToPixels(seconds: number, pixelsPerSecond = 40, zoom = 1) { return seconds * pixelsPerSecond * zoom; }
export type EditorThumbnail = { outputSeconds: number; url: string };
/** Dedicated muted decoder: sampling never seeks the playing preview. */
export async function sampleVideoFrames(url: string, segments: readonly SourceSegment[], previewStart: number, signal?: AbortSignal): Promise<EditorThumbnail[]> {
 const video = document.createElement('video');
 video.muted = true; video.preload = 'auto'; video.src = url;
 const wait = (event: string) => new Promise<void>((resolve, reject) => {
  const cleanup = () => { clearTimeout(timer); video.removeEventListener(event, done); video.removeEventListener('error', fail); signal?.removeEventListener('abort', fail); };
  const done = () => { cleanup(); resolve(); }; const fail = () => { cleanup(); reject(new Error('Frames unavailable')); };
  const timer = setTimeout(fail, 15000);
  video.addEventListener(event, done, {once:true}); video.addEventListener('error', fail, {once:true}); signal?.addEventListener('abort', fail, {once:true}); if(signal?.aborted) fail();
 });
 try {
  await wait('loadeddata');
  const canvas = document.createElement('canvas'); canvas.width = 120; canvas.height = 68;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Frames unavailable');
  const times = thumbnailTimes(segments, Math.max(1, Math.ceil(outputDuration(segments) / 2)));
  const result: EditorThumbnail[] = [];
  for (let i = 0; i < times.length; i++) {
   const local = times[i] - previewStart;
   if (Math.abs(video.currentTime - local) > .001) { const ready = wait('seeked'); video.currentTime = local; await ready; }
   ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
   result.push({outputSeconds: outputDuration(segments) * i / times.length, url: canvas.toDataURL('image/jpeg', .7)});
  }
  return result;
 } finally { video.removeAttribute('src'); video.load(); }
}
export async function decodeEditedPeaks(blob: Blob, segments: readonly SourceSegment[], previewStart: number): Promise<number[] | null> {
 if (typeof AudioContext === 'undefined') return null;
 const context = new AudioContext();
 try {
  const buffer = await context.decodeAudioData(await blob.arrayBuffer());
  const duration = outputDuration(segments);
  const count = Math.max(1, Math.ceil(duration * 8));
  const result = Array<number>(count).fill(0);
  let offset = 0;
  for (const segment of segments) {
   const length = segment.end_seconds - segment.start_seconds;
   for (let bucket = Math.floor(offset / duration * count); bucket < Math.ceil((offset + length) / duration * count); bucket++) {
    const startOutput = Math.max(offset, bucket * duration / count);
    const endOutput = Math.min(offset + length, (bucket + 1) * duration / count);
    const start = Math.max(0, Math.floor((segment.start_seconds - previewStart + startOutput - offset) * buffer.sampleRate));
    const end = Math.min(buffer.length, Math.ceil((segment.start_seconds - previewStart + endOutput - offset) * buffer.sampleRate));
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
     const data = buffer.getChannelData(channel);
     for (let i = start; i < end; i++) result[bucket] = Math.max(result[bucket], Math.abs(data[i]));
    }
   }
   offset += length;
  }
  return result.some(p => p > .00001) ? result : null;
 } catch { return null; } finally { await context.close(); }
}
