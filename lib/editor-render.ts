import { resolveBin, run, runCapture, FFMPEG_THREADS } from "./bin.ts";
import { validateClipEditDraft, type ClipEditDraftV2, type ClipEditDraftV3 } from "./clip-edit-draft.ts";
import { outputDuration, validateSegments, type SourceSegment } from "./editor-timeline.ts";
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
  if (body.raw === true && draft.version === 3 && draft.cutaways.length) throw new RangeError("Raw export omits editor effects. Use normal export to include imported cutaways.");
  return draft;
}

export function buildKeptSegmentsFilter(
  sourceOffsetSeconds: number,
  segments: readonly SourceSegment[],
  hasAudio: boolean,
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
  return filters.join(";");
}

/** Render a continuous intermediate with source audio, preserving native framing for the final pipeline. */
export async function renderKeptSegments(
  sourcePath: string,
  sourceOffsetSeconds: number,
  segments: readonly SourceSegment[],
  outputPath: string,
): Promise<{ duration: number; hasAudio: boolean }> {
  const probe = JSON.parse(await runCapture(resolveBin("ffprobe"), [
    "-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", sourcePath,
  ], { maxRunMs: 30_000 }));
  const duration = Number(probe.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new RangeError("Source duration could not be read.");
  // Container duration can differ from the final video frame by a small rounding interval.
  validateSegments(segments, sourceOffsetSeconds, sourceOffsetSeconds + duration + 0.05);
  const hasAudio = probe.streams.some((stream: { codec_type: string }) => stream.codec_type === "audio");
  const filter = buildKeptSegmentsFilter(sourceOffsetSeconds, segments, hasAudio);
  await run(resolveBin("ffmpeg"), [
    "-i", sourcePath,
    "-filter_complex_threads", String(FFMPEG_THREADS), "-filter_complex", filter,
    "-map", "[video]", ...(hasAudio ? ["-map", "[audio]"] : []),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-threads", String(FFMPEG_THREADS),
    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-y", outputPath,
  ], { stallTimeoutMs: 30_000, maxRunMs: 10 * 60_000 });
  return { duration: outputDuration(segments), hasAudio };
}
