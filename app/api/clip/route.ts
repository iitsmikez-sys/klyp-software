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
import {isLegacyEditorExport} from '@/lib/editor-compatibility';
import { hasProAccess } from '@/lib/tier';
import {handleLegacyClipExport} from '@/lib/legacy-clip-export-route';
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { renderKeptSegments, validateEditorExportRequest } from "@/lib/editor-render";
import { assertOwnedDraftAssets, EditorAssetError } from "@/lib/editor-assets";
import { resolveCutawaySpans, type ResolvedCutawaySpan } from "@/lib/editor-timeline";
import { layoutForFocus, resolveFocusSpans, splitCuesForFocus } from "@/lib/editor-focus";
import { buildCutawayGraph, buildOverlayAudioGraph, cutawayInputArgs, loadEditorCutawayAssets, type RenderableEditorAsset } from "@/lib/editor-cutaway-render";
import { ClipEditDraftError, type ClipEditDraftV2, type ClipEditDraftV3 } from "@/lib/clip-edit-draft";
import { resolveEditorCues, captionAppearance, parseCaptionOptions } from "@/lib/editor-captions";
import type { SavedClip } from "@/lib/clip-ui";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { resolveBin, run, runCapture, FFMPEG_THREADS } from "@/lib/bin";
import { generateAss, generateTimedCueAss, generateHookAss, toFfmpegPath, HOOK_STYLES, type HookStyle } from "@/lib/captions";
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
import { planClipComposition, validateVerticalLayout, visibleFrameRect, type VerticalLayoutPlan, type VerticalLayoutV1 } from "@/lib/vertical-layout";
import { buildTimedVerticalFilterGraph, buildVerticalFilterGraph } from "@/lib/vertical-layout-ffmpeg";
import { getArchivedClip, readArchivedObject } from "@/lib/clip-archive";
import { clipSeekRange, archivedClipTiming } from "@/lib/clip-trim";
import { UPSCALE_COST } from "@/lib/sparks";
import { withCors, corsPreflight } from "@/lib/cors";
import { canProcessClip, canDownloadRawMoment, acquireUserProcessingSlot } from "@/lib/clip-access";

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
async function probeVideoSize(sourcePath: string): Promise<{ w: number; h: number } | null> {
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
  return null;
}

async function cutClip(
  sourcePath: string,
  startSeconds: number,
  endSeconds: number,
  isPro: boolean,
  format: ExportFormat,
  assPath?: string,
  hookAssPath?: string,
  watermarkAssPath?: string,
  handle?: string,
  raw = false,
  upscale = false,
  verticalPlan?: VerticalLayoutPlan,
  cutaways?: { spans: readonly ResolvedCutawaySpan[]; assets: readonly RenderableEditorAsset[]; dimensions: {w:number;h:number}; hasSourceAudio:boolean },
  focusPlans?: readonly { start_ms: number; end_ms: number; plan: VerticalLayoutPlan }[]
): Promise<string> {
  const duration = endSeconds - startSeconds;
  const outPath = path.join(
    CACHE_DIR,
    `clip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`
  );

  // Build video filter chain: framing → imported picture → captions → hook → handle → watermark.
  // Raw mode skips the chain entirely: original
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
  const framing = vf;
  const overlays = [
    ...(assPath ? [`subtitles='${toFfmpegPath(assPath)}'`] : []),
    ...(hookAssPath ? [`subtitles='${toFfmpegPath(hookAssPath)}'`] : []),
    ...(handle ? [handleFilter(handle)] : []),
    ...(!isPro && watermarkAssPath ? [watermarkFilter(watermarkAssPath)] : []),
  ];
  if (overlays.length) vf += `,${overlays.join(',')}`;
  let composed = !raw && focusPlans?.length ? buildTimedVerticalFilterGraph(focusPlans, cutaways ? [] : overlays)
    : !raw && verticalPlan ? buildVerticalFilterGraph(verticalPlan, cutaways ? [] : overlays) : null;
  if (!raw && cutaways) {
    const base = composed ?? { filter: `[0:v]${framing},setsar=1[framed]`, videoLabel: 'framed' };
    const imported = buildCutawayGraph(base.videoLabel, cutaways.spans, cutaways.assets, cutaways.dimensions);
    composed = {
      filter: [base.filter, imported.filter, `[${imported.videoLabel}]${overlays.length ? overlays.join(',')+',' : ''}format=yuv420p,setsar=1[exportv]`].filter(Boolean).join(';'),
      videoLabel: 'exportv',
    };
  }
  let overlayAudio:{filter:string;audioLabel:string|null}={filter:'',audioLabel:null};
  if(!raw&&cutaways?.spans.some(span=>span.placement==='overlay'&&span.muted===false)){
    const assetHasAudio=await Promise.all(cutaways.assets.map(async asset=>asset.kind==='video'&&JSON.parse(await runCapture(resolveBin('ffprobe'),['-v','error','-select_streams','a:0','-show_entries','stream=codec_type','-of','json',asset.localPath],{maxRunMs:30000})).streams?.length>0));
    overlayAudio=buildOverlayAudioGraph(cutaways.spans,cutaways.assets,assetHasAudio,cutaways.hasSourceAudio,duration);
    if(overlayAudio.filter&&composed)composed.filter+=';'+overlayAudio.filter;
  }
  try {
  await run(resolveBin("ffmpeg"), [
    "-ss", String(startSeconds),
    "-t", String(duration),
    "-i", sourcePath,
    ...(cutaways ? cutawayInputArgs(cutaways.assets) : []),
    ...(raw ? [] : composed ? ["-filter_complex_threads", String(FFMPEG_THREADS), "-filter_complex", composed.filter, "-map", `[${composed.videoLabel}]`, "-map", overlayAudio.audioLabel?`[${overlayAudio.audioLabel}]`:"0:a?"] : ["-vf", vf]),
    "-t", String(duration),
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
  } catch (error) {
    await rm(outPath, { force: true }).catch(() => {});
    throw error;
  }

  return outPath;
}

function sanitizeFilename(title: string): string {
  const safe = title.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_").slice(0, 60);
  return (safe || "klyp_clip") + ".mp4";
}

export async function POST(req: NextRequest): Promise<Response> {
  return withCors(await handlePOST(req));
}

async function handlePOST(req: NextRequest): Promise<Response> {
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
  let handle: string | undefined;
  let format: ExportFormat = "9:16";
  let hook: string | undefined;
  let hookStyle: HookStyle = "IMPACT";
  let raw = false;
  let upscale = false;
  let requestedLayout: unknown;
  let requestBody: Record<string, unknown>;
  let editorDraft: ClipEditDraftV2 | ClipEditDraftV3 | null = null;
  let ownedEditorClip: SavedClip | null = null;
  try {
    const body = await req.json();
    requestBody = body;
    if (isLegacyEditorExport(body)) return handleLegacyClipExport(req, body);
    clipId = String(body.clip_id ?? "");
    raw = body.raw === true;
    upscale = body.upscale === true && !raw; // upscale applies to rendered exports only
    requestedLayout = body.vertical_layout;
    url = String(body.url ?? "").trim();
    start = Number(body.start_seconds);
    end = Number(body.end_seconds);
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
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
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
  // "Pro" requires a real, confirmed subscription — see SparksProvider.tsx for
  // why the raw tier flag alone isn't trusted (it can drift from reality).
  const isPro = hasProAccess(profile);
  const sparksBalance = profile.sparks;
  // Raw always means the detected source moment, never an edited draft.
  const editorRequested = !raw && (requestBody.edit_draft !== undefined || requestBody.editor_export === true || requestBody.segments !== undefined || requestBody.caption_cues !== undefined);
  if (raw && clipId) {
    try {
      const { data, error } = await createAdminClient().from("clips")
        .select("id,url,title,start_seconds,end_seconds")
        .eq("id", clipId).eq("user_id", profile.id).maybeSingle();
      if (error) throw error;
      if (!data) return NextResponse.json({ error: "Clip not found." }, { status: 404 });
      url = data.url;
      start = data.start_seconds;
      end = data.end_seconds;
      title = data.title;
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load this clip." }, { status: 500 });
    }
  }
  if (editorRequested) {
    try {
      const { data, error } = await createAdminClient().from("clips")
        .select("id,url,title,start_seconds,end_seconds,words,edit_draft")
        .eq("id", clipId).eq("user_id", profile.id).maybeSingle();
      if (error) throw error;
      if (!data) return NextResponse.json({ error: "Clip not found." }, { status: 404 });
      ownedEditorClip = data as SavedClip;
      editorDraft = validateEditorExportRequest(requestBody, ownedEditorClip);
      if (editorDraft) {
        await assertOwnedDraftAssets(profile.id, clipId, editorDraft);
        url = ownedEditorClip.url;
        start = editorDraft.start_seconds;
        end = editorDraft.end_seconds;
        title = editorDraft.title;
        hook = editorDraft.hook || undefined;
        hookStyle = editorDraft.hook_style;
        style = editorDraft.caption_style;
        words = undefined;
        format = editorDraft.aspect_ratio;
        requestedLayout = editorDraft.vertical_layout;
      }
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid editor export." }, { status: error instanceof EditorAssetError ? error.status : error instanceof ClipEditDraftError || error instanceof RangeError ? 400 : 500 });
    }
  }
  try {
    if (raw ? (!clipId && !await canDownloadRawMoment(profile.id, url, start, end)) : !await canProcessClip(profile.id, clipId, url, start, end)) {
      return NextResponse.json({ error: "This clip is not in your saved clips or analysis results." }, { status: 403 });
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Clip access check failed." }, { status: 500 });
  }
  if (!VOD_URL_PATTERN.test(url) && !isUploadRef(url)) {
    return NextResponse.json({ error: "Invalid VOD URL." }, { status: 400 });
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return NextResponse.json({ error: "Invalid start/end timestamps." }, { status: 400 });
  }
  if (!editorDraft && end - start > 180) {
    return NextResponse.json({ error: "Clips are capped at 3 minutes." }, { status: 400 });
  }
  format = raw ? "Original" : resolveExportFormat(format, isPro);
  let verticalLayout: VerticalLayoutV1 | null = null;
  let layoutWarning: string | null = null;
  if (!raw && format === "9:16") {
    // Omitted means inherit; explicit null means full frame, matching the editor.
    const override = requestedLayout !== undefined;
    const selected = override ? requestedLayout : profile.vertical_layout;
    try { verticalLayout = selected ? validateVerticalLayout(selected) : null; }
    catch {
      if (override) return NextResponse.json({ error: "Invalid vertical layout." }, { status: 400 });
      layoutWarning = "Saved layout is invalid; the full frame was exported.";
    }
  }
  if (editorDraft?.version === 3 && editorDraft.focus_events?.length && format === "9:16" && !verticalLayout?.facecam) {
    return NextResponse.json({ error: "Add a facecam to the vertical layout before exporting focus changes." }, { status: 400 });
  }

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

  // Raw footage is already paid for by analysis. It has no Klyp effects or
  // additional Sparks charge; ownership and exact-window checks apply above.
  if (raw) {
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
  let editorDir: string | null = null;
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
      let offsetSeconds = start;
      let archivedEndSeconds: number | undefined;
      let archivedMaster: string | null = null;
      if (clipId) {
        const archived = await getArchivedClip(clipId, profile.id);
        if (archived?.masterPath && archived.status === "stored") {
          clipSeekRange(start, end, archived.originalStartSeconds, archived.originalEndSeconds);
          const bytes = await readArchivedObject(archived.masterPath, archived.provider);
          if (bytes) {
            archivedMaster = path.join(CACHE_DIR, `master-${archived.id}.mp4`);
            await mkdir(CACHE_DIR, { recursive: true });
            await writeFile(archivedMaster, bytes);
            offsetSeconds = archivedClipTiming(archived.originalStartSeconds).sourceStart;
            archivedEndSeconds = archived.originalEndSeconds;
            log("using archived master", archived.masterPath, `${(bytes.byteLength / 1e6).toFixed(1)}MB`);
          } else {
            log("archived master missing, falling back to source", archived.masterPath);
          }
        }
      }

      if (archivedMaster) {
        // The master begins at the ORIGINAL clip start. A draft trim must
        // seek forward within it instead of treating the edited start as zero.
        sourcePath = archivedMaster;
      } else {
        const resolved = await resolveSourceSegment(url, start, end, 1080, 10 * 60_000, profile.id);
        sourcePath = resolved.path;
        offsetSeconds = resolved.offsetSeconds;
        log("source resolved in", `${((Date.now() - t0) / 1000).toFixed(1)}s`, `offset=${offsetSeconds}s`);
      }

      let editedDuration: number | null = null;
      let editedHasAudio=false;
      let editorAssets: RenderableEditorAsset[] = [];
      if (editorDraft) {
        editorDir = await mkdtemp(path.join(tmpdir(), "klyp-editor-"));
        if(editorDraft.version===3 && (editorDraft.cutaways.length || editorDraft.inserts?.length)) editorAssets=await loadEditorCutawayAssets(profile.id,clipId,editorDraft,editorDir);
        const editedPath = path.join(editorDir, "kept.mp4");
        const rendered = await renderKeptSegments(sourcePath, offsetSeconds, editorDraft.segments, editedPath, raw ? "off" : editorDraft.audio_polish ?? "off",editorDraft.version===3&&editorDraft.inserts?.length?{items:editorDraft.inserts,assets:editorAssets}:undefined);
        sourcePath = editedPath;
        editedDuration = rendered.duration;
        editedHasAudio=rendered.hasAudio;
      }

      // ASS PlayRes must match the output resolution so burned text scales with it.
      // "Original" has no fixed dimensions — probe the source for its native size.
      let res: { w: number; h: number };
      if (format === "Original") {
        const t1 = Date.now();
        res = await probeVideoSize(sourcePath) ?? { w: 1920, h: 1080 };
        log("probed source size", `${res.w}x${res.h}`, `in ${((Date.now() - t1) / 1000).toFixed(1)}s`);
      } else {
        res = FORMAT_DIMENSIONS[format];
      }
      if (upscale) res = { w: res.w * 2, h: res.h * 2 };
      let verticalPlan: VerticalLayoutPlan | undefined;
      let focusPlans: { start_ms: number; end_ms: number; plan: VerticalLayoutPlan }[] | undefined;
      if (!raw && format !== "Original") {
        const native = await probeVideoSize(sourcePath);
        if (!native && verticalLayout) {
          verticalLayout = null;
          layoutWarning = "Source dimensions could not be read; the full frame was exported.";
        }
        // When probing fails, nonvertical exports retain the dynamic scale/crop fallback.
        if (native || format === "9:16") verticalPlan = planClipComposition(native ?? { w: 1920, h: 1080 }, format, verticalLayout, res);
        if (editorDraft?.version === 3 && editorDraft.focus_events?.length && format === "9:16" && verticalLayout?.facecam) {
          focusPlans = resolveFocusSpans(editorDraft.focus_events, editorDraft.segments,editorDraft.inserts).map(span => ({
            start_ms: span.start_ms, end_ms: span.end_ms,
            plan: planClipComposition(native ?? { w: 1920, h: 1080 }, format, layoutForFocus(verticalLayout, span.mode), res),
          }));
        }
      }

      let assPath: string | undefined;
      let hookAssPath: string | undefined;
      if ((style && (editorDraft || (words && words.length > 0))) || hook || !isPro) {
        assDir = await mkdtemp(path.join(tmpdir(), "klyp-ass-"));
      }
      let watermarkAssPath: string | undefined;
      if (!isPro) {
        watermarkAssPath = path.join(assDir!, "watermark.ass");
        await writeFile(watermarkAssPath, generateWatermarkAss(res, editedDuration ?? end - start), "utf-8");
      }
      if (style && editorDraft && ownedEditorClip && !raw) {
        const safe = verticalPlan?.textSafe;
        const cues = resolveEditorCues(editorDraft, ownedEditorClip);
        const spans = editorDraft.version === 3 && focusPlans ? resolveFocusSpans(editorDraft.focus_events ?? [], editorDraft.segments,editorDraft.inserts) : null;
        const resolvedCues = spans ? splitCuesForFocus(cues, spans) : cues;
        const captionSafe = spans && focusPlans ? (cue: { start_ms: number }) => {
          const plan = focusPlans!.find(span => cue.start_ms >= span.start_ms && cue.start_ms < span.end_ms)?.plan;
          return plan?.textSafe ?? { x: 0, y: 0, w: res.w, h: res.h };
        } : safe;
        if (resolvedCues.length) {
          assPath = path.join(assDir!, "captions.ass");
          await writeFile(assPath, generateTimedCueAss(resolvedCues, style, captionAppearance(editorDraft), res, captionSafe, editorDraft.caption_font ?? "sans"), "utf-8");
        }
      } else if (style && words && words.length > 0) {
        assPath = path.join(assDir!, "captions.ass");
        const bottomInset = verticalPlan?.mode === "composed" ? res.h - verticalPlan.textSafe.y - verticalPlan.textSafe.h
          : verticalPlan?.mode === "full_frame" ? res.h - verticalPlan.textSafe.y - verticalPlan.textSafe.h : 0;
        const assContent = generateAss(words, start * 1000, end * 1000, style, res, bottomInset, !!verticalPlan, parseCaptionOptions(requestBody));
        await writeFile(assPath, assContent, "utf-8");
      }
      if (hook) {
        hookAssPath = path.join(assDir!, "hook.ass");
        await writeFile(hookAssPath, generateHookAss(hook, res, hookStyle, editorDraft?.hook_placement), "utf-8");
      }

      const t2 = Date.now();
      const seek = editedDuration !== null ? { start: 0, end: editedDuration } : clipSeekRange(start, end, offsetSeconds, archivedEndSeconds);
      const cutawaySpans = editorDraft?.version === 3 ? resolveCutawaySpans(editorDraft) : [];
      const cutaways = cutawaySpans.length && editorDraft?.version === 3 ? {
        spans: cutawaySpans,
        assets: editorAssets,
        dimensions: res,
        hasSourceAudio:editedHasAudio,
      } : undefined;
      const result = await cutClip(
        sourcePath,
        seek.start,
        seek.end,
        isPro,
        format,
        assPath,
        hookAssPath,
        watermarkAssPath,
        handle,
        raw,
        upscale,
        verticalPlan,
        cutaways,
        focusPlans
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
        ...(layoutWarning ? { "X-Klyp-Layout-Warning": layoutWarning } : {}),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Clip generation failed.";
    log("FAILED:", message);
    return NextResponse.json({ error: message }, { status: err instanceof EditorAssetError ? err.status : err instanceof RangeError ? 400 : 500 });
  } finally {
    releaseSlot();
    if (clipPath) rm(clipPath, { force: true }).catch(() => {});
    if (assDir) await rm(assDir, { recursive: true, force: true }).catch(() => {});
    if (editorDir) await rm(editorDir, { recursive: true, force: true }).catch(() => {});
  }
}
