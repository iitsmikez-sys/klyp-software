import type { EditSegment } from "./edit-segments";
import type { MediaInsert } from "./editor-media";

/** FFmpeg graph for a timeline containing source sections and imported full-frame media. */
export function buildEditorMediaFilter(
  segments: EditSegment[], media: MediaInsert[], sourceHasAudio: boolean,
  mediaHasAudio: boolean[], width: number, height: number, postFilter?: string,
): { graph: string; videoLabel: string; audioLabel: string } {
  const parts: string[] = [];
  const labels: string[] = [];
  let index = 0;
  const append = (input: number, from: number, to: number, audio: boolean) => {
    const duration = to - from;
    const prefix = `s${index++}`;
    parts.push(`[${input}:v]trim=start=${from}:end=${to},setpts=PTS-STARTPTS,fps=30,` +
      `scale=${width}:${height}:force_original_aspect_ratio=increase:force_divisible_by=2,` +
      `crop=${width}:${height},setsar=1,format=yuv420p[v${prefix}]`);
    if (audio) {
      parts.push(`[${input}:a]atrim=start=${from}:end=${to},asetpts=PTS-STARTPTS,` +
        `aresample=48000,aformat=channel_layouts=stereo[a${prefix}]`);
    } else {
      parts.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${duration},` +
        `asetpts=PTS-STARTPTS[a${prefix}]`);
    }
    labels.push(`[v${prefix}][a${prefix}]`);
  };
  const appendMediaAfter = (section: number) => media.forEach((entry, mediaIndex) => {
    if (entry.after === section && entry.placement !== "overlay") append(mediaIndex + 1, 0, entry.duration, mediaHasAudio[mediaIndex] === true);
  });
  appendMediaAfter(-1);
  segments.forEach((section, sectionIndex) => {
    append(0, section.start, section.end, sourceHasAudio);
    appendMediaAfter(sectionIndex);
  });
  parts.push(`${labels.join("")}concat=n=${labels.length}:v=1:a=1[vcat][acat]`);
  let videoLabel = "[vcat]";
  media.forEach((entry, mediaIndex) => {
    if (entry.placement !== "overlay") return;
    const overlayLabel = `overlay${mediaIndex}`;
    const nextLabel = `composite${mediaIndex}`;
    parts.push(`[${mediaIndex + 1}:v]trim=duration=${entry.duration},setpts=PTS-STARTPTS+${entry.at}/TB,` +
      `fps=30,scale=${width}:${height}:force_original_aspect_ratio=increase:force_divisible_by=2,` +
      `crop=${width}:${height},setsar=1,format=yuv420p[${overlayLabel}]`);
    parts.push(`${videoLabel}[${overlayLabel}]overlay=0:0:eof_action=pass:enable='between(t,${entry.at},${entry.at! + entry.duration})'[${nextLabel}]`);
    videoLabel = `[${nextLabel}]`;
  });
  if (postFilter) { parts.push(`${videoLabel}${postFilter}[vout]`); videoLabel = "[vout]"; }
  return { graph: parts.join(";"), videoLabel, audioLabel: "[acat]" };
}
