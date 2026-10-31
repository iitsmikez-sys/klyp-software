/**
 * POST /api/clip — Klyp's clipping pipeline, stage 2 (the cutter).
 *
 * Takes a VOD URL + one clip's timestamps (from /api/analyze) and returns the
 * actual MP4:
 *   1. Download just the needed slice with yt-dlp (see resolveSourceSegment in
 *      lib/video-cache.ts — downloading the full VOD here used to OOM/exhaust
 *      disk on multi-hour streams; clips are capped at 3 minutes so a segment
 *      fetch is always enough)
 *   2. Cut start→end with FFmpeg, center-crop to the selected format (9:16 /
 *      1:1 / 16:9) — or no crop at all for "Original" (native aspect ratio)
 *   3. Burn captions (if style + words provided)
 *   4. Burn animated watermark (free tier only)
 *   5. Stream the MP4 back as a file download
 */
import { NextRequest, NextResponse } from "next/server";
import { hasProAccess } from "@/lib/tier";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { resolveBin, run, runCapture, FFMPEG_THREADS } from "@/lib/bin";
import { generateAss, generateHookAss, toFfmpegPath, HOOK_STYLES, type HookStyle } from "@/lib/captions";
import {
  CAPTION_STYLES,
  EXPORT_FORMATS,
  FORMAT_DIMENSIONS,
  resolveExportFormat,
  type CaptionStyle,
  type ExportFormat,
  type TimedWord,
} from "@/lib/clips";
import { resolveSourceSegment, isUploadRef, CACHE_DIR } from "@/lib/video-cache";
import { runQueued } from "@/lib/job-queue";
import { generateWatermarkAss, watermarkFilter } from "@/lib/watermark";
import { bearerToken, getProfileFromToken, consumeSparksFromToken } from "@/lib/profile-token";
import { getArchivedClip, readArchivedObject } from "@/lib/clip-archive";
import { UPSCALE_COST } from "@/lib/sparks";
import { withCors, corsPreflight } from "@/lib/cors";
import { canProcessClip, acquireUserProcessingSlot } from "@/lib/clip-access";
import { archivedClipTiming } from "@/lib/clip-trim";
import { buildSegmentFilter, parseSegments, retimeWords, timelineDuration, type EditSegment } from "@/lib/edit-segments";
import { editorMediaPath, parseMediaInserts, retimeWordsWithMedia, buildEditorTimeline, type MediaInsert } from "@/lib/editor-media";
import { buildEditorMediaFilter } from "@/lib/editor-media-render";
import { parseCaptionOptions, parseEditedWords } from "@/lib/editor-captions";

export const runtime = "nodejs";
export const maxDuration = 300;

export const OPTIONS = corsPreflight;

const VOD_URL_PATTERN =
  /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|twitch\.tv\/videos\/|m\.twitch\.tv\/videos\/)/i;

/**
 * Static streamer-handle overlay, top-right corner. The handle is validated
 * to [A-Za-z0-9_] before it reaches this filter, so no drawtext escaping issues.
 */
function handleFilter(handle: string): string {
  return [
    `drawtext=text='@${handle}'`,
    // DejaVu is installed explicitly on the container (railpack.json) so this
    // always resolves in production. "Arial Bold" silently fell back to a
    // serif default everywhere but Windows, and on a Debian image with no
    // fonts at all drawtext fails hard and kills the whole export. A missing
    // family degrades to the default font rather than erroring, so this is
    // safe on dev machines that lack DejaVu.
    `font='DejaVu Sans'`,
    `fontsize=44`,
    `fontcolor=white@0.95`,
    // Semi-transparent pill behind the text so it stays legible over bright
    // or busy footage, where the old drop shadow alone washed out.
    `box=1`,
    `boxcolor=black@0.45`,
    `boxborderw=14`,
    `x=main_w-tw-28`,
    `y=96`,
  ].join(":");
}

/** Native video dimensions via ffprobe — used as ASS PlayRes for "Original" exports. */
async function probeVideoSize(sourcePath: string): Promise<{ w: number; h: number }> {
  try {
    const out = await runCapture(resolveBin("ffprobe"), [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height",
      "-of", "csv=p=0",
      sourcePath,
    ], { maxRunMs: 30_000 });
    const [w, h] = out.trim().split(",").map(Number);
    if (w > 0 && h > 0) return { w, h };
  } catch {
    // fall through to the 1080p default below
  }
  return { w: 1920, h: 1080 };
}

async function hasAudioStream(sourcePath: string): Promise<boolean> {
  const out = await runCapture(resolveBin("ffprobe"), [
    "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=index",
    "-of", "csv=p=0", sourcePath,
  ], { maxRunMs: 30_000 });
  return out.trim().length > 0;
}

async function cutClip(
  sourcePath: string,
  startSeconds: number,
  endSeconds: number,
  segments: EditSegment[],
  mediaFiles: Array<{ entry: MediaInsert; path: string }>,
  isPro: boolean,
  format: ExportFormat,
  outputSize: { w: number; h: number },
  assPath?: string,
  hookAssPath?: string,
  watermarkAssPath?: string,
  handle?: string,
  raw = false,
  upscale = false
): Promise<string> {
  const first = segments[0];
  const multiSection = segments.length > 1;
  const hasMedia = mediaFiles.length > 0;
  const inputStart = multiSection || hasMedia ? startSeconds : startSeconds + first.start;
  const inputDuration = multiSection || hasMedia ? endSeconds - startSeconds : first.end - first.start;
  const outPath = path.join(
    CACHE_DIR,
    `clip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`
  );

  // Build video filter chain: scale+crop → captions → hook title → handle → watermark.
  // Raw mode (Pro-only, enforced in POST) skips the chain entirely: original
  // framing and resolution, nothing burned in — for editing in CapCut/Premiere.
  // Upscale (Pro-only, 35⚡) doubles the output dimensions (e.g. 2160×3840).
  let vf: string;
  if (format === "Original") {
    // No crop — keep the source's native aspect ratio; only trim (2× if upscaling).
    // `null` is ffmpeg's no-op video filter, so the rest of the chain appends cleanly.
    vf = upscale ? "scale=iw*2:ih*2" : "null";
  } else {
    let { w, h } = FORMAT_DIMENSIONS[format];
    if (upscale) {
      w *= 2;
      h *= 2;
    }
    vf = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`;
  }
  if (assPath) {
    vf += `,subtitles='${toFfmpegPath(assPath)}'`;
  }
  if (hookAssPath) {
    vf += `,subtitles='${toFfmpegPath(hookAssPath)}'`;
  }
  if (handle) {
    vf += `,${handleFilter(handle)}`;
  }
  if (!isPro && watermarkAssPath) {
    vf += `,${watermarkFilter(watermarkAssPath)}`;
  }

  const audio = multiSection || hasMedia ? await hasAudioStream(sourcePath) : true;
  const segmentFilter = multiSection && !hasMedia ? buildSegmentFilter(segments, raw ? undefined : vf, audio) : null;
  const mediaAudio = hasMedia ? await Promise.all(mediaFiles.map(({ entry, path }) =>
    entry.kind === "video" ? hasAudioStream(path) : Promise.resolve(false))) : [];
  const mediaFilter = hasMedia ? buildEditorMediaFilter(segments, mediaFiles.map(({ entry }) => entry),
    audio, mediaAudio, outputSize.w - outputSize.w % 2, outputSize.h - outputSize.h % 2,
    raw ? undefined : vf) : null;
  await run(resolveBin("ffmpeg"), [
    "-ss", String(inputStart),
    "-t", String(inputDuration),
    "-i", sourcePath,
    ...mediaFiles.flatMap(({ entry, path }) => entry.kind === "image"
      ? ["-loop", "1", "-framerate", "30", "-t", String(entry.duration), "-i", path]
      : ["-i", path]),
    ...(mediaFilter
      ? ["-filter_complex", mediaFilter.graph, "-map", mediaFilter.videoLabel, "-map", mediaFilter.audioLabel]
      : segmentFilter
      ? ["-filter_complex", segmentFilter.graph, "-map", segmentFilter.videoLabel,
          ...(segmentFilter.audioLabel ? ["-map", segmentFilter.audioLabel] : [])]
      : raw ? [] : ["-vf", vf]),
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "23",
    "-threads", String(FFMPEG_THREADS),
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "+faststart",
    "-y",
    outPath,
  ],
  // ffmpeg prints progress to stderr continuously — silence means it's wedged.
  // maxRunMs bounds the whole encode so an export can't hang forever.
  { stallTimeoutMs: 30_000, maxRunMs: 10 * 60_000 });

  return outPath;
}

function sanitizeFilename(title: string): string {
  const safe = title.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_").slice(0, 60);
  return (safe || "klyp_clip") + ".mp4";
}

export async function POST(req: NextRequest): Promise<Response> {
  return withCors(await handleLegacyClipExport(req));
}

export async function handleLegacyClipExport(req: NextRequest, parsedBody?: Record<string, unknown>): Promise<Response> {
  // This route only runs on the processing service — set DEPLOYMENT_TARGET
  // there (and in local dev's .env.local, where one server plays both roles).
  if (process.env.DEPLOYMENT_TARGET !== "processing") {
    return NextResponse.json({ error: "This endpoint only runs on the processing service." }, { status: 404 });
  }

  const reqId = Math.random().toString(36).slice(2, 8);
  const log = (...args: unknown[]) => console.log(`[clip ${reqId}]`, new Date().toISOString(), ...args);

  let url: string, start: number, end: number, title: string, clipId: string;
  let style: CaptionStyle | undefined;
  let words: TimedWord[] | undefined;
  let captionOptions = parseCaptionOptions({});
  let handle: string | undefined;
  let format: ExportFormat = "9:16";
  let hook: string | undefined;
  let hookStyle: HookStyle = "IMPACT";
  let raw = false;
  let upscale = false;
  let requestedSegments: unknown;
  let requestedMedia: unknown;
  try {
    const body = parsedBody ?? await req.json();
    clipId = String(body.clip_id ?? "");
    raw = body.raw === true;
    upscale = body.upscale === true && !raw; // upscale applies to rendered exports only
    url = String(body.url ?? "").trim();
    start = Number(body.start_seconds);
    end = Number(body.end_seconds);
    requestedSegments = body.segments;
    requestedMedia = body.media ?? [];
    title = String(body.title ?? "klyp clip");

    if ((EXPORT_FORMATS as readonly string[]).includes(body.aspect_ratio)) {
      format = body.aspect_ratio as ExportFormat;
    }

    // Hook title burned over the first seconds — sanitized in generateHookAss.
    const rawHook = String(body.hook ?? "").trim();
    if (rawHook.length > 0) {
      hook = rawHook.slice(0, 80);
    }
    if ((HOOK_STYLES as readonly string[]).includes(body.hook_style)) {
      hookStyle = body.hook_style as HookStyle;
    }

    // Streamer handle overlay — strict charset so it's safe inside drawtext.
    const rawHandle = String(body.handle ?? "").replace(/^@/, "").trim();
    if (/^[A-Za-z0-9_]{1,25}$/.test(rawHandle)) {
      handle = rawHandle;
    }

    if (body.style && (CAPTION_STYLES as readonly string[]).includes(body.style)) {
      style = body.style as CaptionStyle;
    }
    if (Array.isArray(body.words) && body.words.length > 0) {
      words = body.words as TimedWord[];
    }
    captionOptions = parseCaptionOptions(body);
    if (body.caption_edits !== undefined) {
      if (!words) throw new Error("Captions are unavailable for this clip.");
      words = parseEditedWords(body.caption_edits, words);
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Invalid JSON body." }, { status: 400 });
  }

  if (!VOD_URL_PATTERN.test(url) && !isUploadRef(url)) {
    return NextResponse.json({ error: "Invalid VOD URL." }, { status: 400 });
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return NextResponse.json({ error: "Invalid start/end timestamps." }, { status: 400 });
  }
  if (end - start > 180) {
    return NextResponse.json({ error: "Clips are capped at 3 minutes." }, { status: 400 });
  }
  let segments: EditSegment[];
  let media: MediaInsert[];
  try {
    segments = requestedSegments === undefined
      ? [{ start: 0, end: end - start }]
      : parseSegments(requestedSegments, end - start);
    media = parseMediaInserts(requestedMedia, segments);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid clip sections." },
      { status: 400 }
    );
  }

  // Require a signed-in session, verified via Bearer token (not cookies —
  // this service is on a different origin than the frontend that calls it).
  const token = bearerToken(req);
  let profile;
  try {
    profile = token ? await getProfileFromToken(token) : null;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load your profile." },
      { status: 500 }
    );
  }
  if (!profile) {
    return NextResponse.json({ error: "You must be signed in to export clips." }, { status: 401 });
  }
  try {
    if (!await canProcessClip(profile.id, clipId, url, start, end)) {
      return NextResponse.json({ error: "This clip is not in your saved clips or analysis results." }, { status: 403 });
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Clip access check failed." }, { status: 500 });
  }
  // "Pro" requires a real, confirmed subscription — see SparksProvider.tsx for
  // why the raw tier flag alone isn't trusted (it can drift from reality).
  const isPro = hasProAccess(profile);
  const sparksBalance = profile.sparks;

  format = resolveExportFormat(format, isPro);

  if (upscale) {
    if (!isPro) {
      return NextResponse.json(
        { error: "Upscaled exports are a Pro feature." },
        { status: 403 }
      );
    }
    if (sparksBalance !== null && sparksBalance < UPSCALE_COST) {
      return NextResponse.json(
        { error: `Not enough Sparks — upscaling costs ${UPSCALE_COST} ⚡ and you have ${sparksBalance}.` },
        { status: 402 }
      );
    }
  }

  // Raw export (clean cut, nothing burned in) is Pro-only — enforced here, not
  // in the UI, so free users can't get a watermark-free clip by crafting a request.
  if (raw) {
    if (media.length > 0) {
      return NextResponse.json({ error: "Raw export cannot include imported media." }, { status: 400 });
    }
    if (!isPro) {
      return NextResponse.json(
        { error: "Raw exports are a Pro feature — upgrade to download clean clips for editing." },
        { status: 403 }
      );
    }
    style = undefined;
    words = undefined;
    hook = undefined;
    handle = undefined;
  }

  log("start", url.slice(0, 100), `${start}-${end}s`, `format=${format}`, raw ? "raw" : "", upscale ? "upscale" : "");
  const releaseSlot = acquireUserProcessingSlot(profile.id);
  if (!releaseSlot) return NextResponse.json({ error: "Too many clip requests are processing. Try again shortly." }, { status: 429 });
  let clipPath: string | null = null;
  let assDir: string | null = null;
  let mediaDir: string | null = null;
  try {
    const t0 = Date.now();
    // Concurrency-capped: the download (yt-dlp) + encode (ffmpeg) below are
    // the actual CPU/memory-heavy work — the sparks charge and response
    // streaming after it are cheap I/O and stay outside the queued slot.
    clipPath = await runQueued(`clip:${reqId}`, async () => {
      // Fetch only the slice this clip needs, not the whole VOD. The returned
      // offset is where that slice begins in the original timeline, so the cut
      // below must seek relative to it (a segment file starts at 0).
      // Prefer this clip's archived master. It is already the exact range at
      // 1080p, so there is no download and no re-cut — and it is the only way
      // an export can still work once the source VOD has been deleted. Scoped
      // to the caller's own id inside getArchivedClip.
      let sourcePath: string;
      let offsetSeconds: number;
      let archivedMaster: string | null = null;
      if (clipId) {
        const archived = await getArchivedClip(clipId, profile.id);
        if (archived?.masterPath && archived.status === "stored") {
          if (Math.abs(start - archived.originalStartSeconds) > 0.001 ||
              Math.abs(end - archived.originalEndSeconds) > 0.001) {
            throw new RangeError("Edited clip does not match the saved original.");
          }
          const bytes = await readArchivedObject(archived.masterPath, archived.provider);
          if (bytes) {
            archivedMaster = path.join(CACHE_DIR, `master-${archived.id}.mp4`);
            await mkdir(CACHE_DIR, { recursive: true });
            await writeFile(archivedMaster, bytes);
            log("using archived master", archived.masterPath, `${(bytes.byteLength / 1e6).toFixed(1)}MB`);
          } else {
            log("archived master missing, falling back to source", archived.masterPath);
          }
        }
      }

      if (archivedMaster) {
        // Archive jobs floor the saved clip's start before encoding the master.
        sourcePath = archivedMaster;
        offsetSeconds = archivedClipTiming(start).sourceStart;
      } else {
        const resolved = await resolveSourceSegment(url, start, end, 1080, 10 * 60_000, profile.id);
        sourcePath = resolved.path;
        offsetSeconds = resolved.offsetSeconds;
        log("source resolved in", `${((Date.now() - t0) / 1000).toFixed(1)}s`, `offset=${offsetSeconds}s`);
      }

      // ASS PlayRes must match the output resolution so burned text scales with it.
      // "Original" has no fixed dimensions — probe the source for its native size.
      let res: { w: number; h: number };
      if (format === "Original") {
        const t1 = Date.now();
        res = await probeVideoSize(sourcePath);
        log("probed source size", `${res.w}x${res.h}`, `in ${((Date.now() - t1) / 1000).toFixed(1)}s`);
      } else {
        res = FORMAT_DIMENSIONS[format];
      }
      if (upscale) res = { w: res.w * 2, h: res.h * 2 };

      const mediaFiles: Array<{ entry: MediaInsert; path: string }> = [];
      if (media.length > 0) {
        if (!clipId || !await getArchivedClip(clipId, profile.id)) {
          throw new Error("Clip not found for imported media.");
        }
        mediaDir = await mkdtemp(path.join(tmpdir(), "klyp-import-render-"));
        for (const entry of media) {
          const objectPath = editorMediaPath(profile.id, clipId, entry.id, entry.kind);
          const bytes = await readArchivedObject(objectPath);
          if (!bytes) throw new Error("An imported image or video is no longer available.");
          const localPath = path.join(/* turbopackIgnore: true */ mediaDir, `${entry.id}.${entry.kind === "image" ? "jpg" : "mp4"}`);
          await writeFile(localPath, bytes);
          if (entry.kind === "video") {
            const probe = await runCapture(resolveBin("ffprobe"), ["-v", "error", "-show_entries", "format=duration",
              "-of", "default=noprint_wrappers=1:nokey=1", localPath], { maxRunMs: 30_000 });
            if (entry.duration > Number(probe.trim()) + 0.2) {
              throw new Error("An imported video's selected duration exceeds the uploaded file.");
            }
          }
          mediaFiles.push({ entry, path: localPath });
        }
      }

      let assPath: string | undefined;
      let hookAssPath: string | undefined;
      if ((style && words && words.length > 0) || hook || !isPro) {
        assDir = await mkdtemp(path.join(tmpdir(), "klyp-ass-"));
      }
      let watermarkAssPath: string | undefined;
      if (!isPro) {
        watermarkAssPath = path.join(assDir!, "watermark.ass");
        const outputDuration = media.length
          ? buildEditorTimeline(segments, media).at(-1)!.end
          : timelineDuration(segments);
        await writeFile(watermarkAssPath, generateWatermarkAss(res, outputDuration), "utf-8");
      }
      if (style && words && words.length > 0) {
        assPath = path.join(assDir!, "captions.ass");
        const editedWords = media.length ? retimeWordsWithMedia(words, start, segments, media) : retimeWords(words, start, segments);
        const duration = media.length ? buildEditorTimeline(segments, media).at(-1)!.end : timelineDuration(segments);
        const assContent = generateAss(editedWords, 0, duration * 1000, style, res, captionOptions);
        await writeFile(assPath, assContent, "utf-8");
      }
      if (hook) {
        hookAssPath = path.join(assDir!, "hook.ass");
        await writeFile(hookAssPath, generateHookAss(hook, res, hookStyle), "utf-8");
      }

      const t2 = Date.now();
      const result = await cutClip(
        sourcePath,
        start - offsetSeconds,
        end - offsetSeconds,
        segments,
        mediaFiles,
        isPro,
        format,
        res,
        assPath,
        hookAssPath,
        watermarkAssPath,
        handle,
        raw,
        upscale
      );
      log("clip cut in", `${((Date.now() - t2) / 1000).toFixed(1)}s`);
      return result;
    });

    // Charge for the upscale only after the render succeeded.
    if (upscale) {
      await consumeSparksFromToken(token!, UPSCALE_COST);
    }

    const fileBuffer = await readFile(/* turbopackIgnore: true */ clipPath);
    log("done, total", `${((Date.now() - t0) / 1000).toFixed(1)}s`, `${(fileBuffer.byteLength / 1e6).toFixed(1)}MB`);
    return new NextResponse(fileBuffer, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(fileBuffer.byteLength),
        "Content-Disposition": `attachment; filename="${sanitizeFilename(title)}"`,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Clip generation failed.";
    log("FAILED:", message);
    return NextResponse.json({ error: message }, { status: err instanceof RangeError ? 400 : 500 });
  } finally {
    releaseSlot();
    if (clipPath) rm(clipPath, { force: true }).catch(() => {});
    if (mediaDir) rm(mediaDir, { recursive: true, force: true }).catch(() => {});
    if (assDir) rm(assDir, { recursive: true, force: true }).catch(() => {});
  }
}
