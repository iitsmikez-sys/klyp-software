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
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { resolveBin, run, runCapture, FFMPEG_THREADS } from "@/lib/bin";
import { generateAss, generateHookAss, toFfmpegPath, HOOK_STYLES, type HookStyle } from "@/lib/captions";
import {
  CAPTION_STYLES,
  EXPORT_FORMATS,
  FORMAT_DIMENSIONS,
  type CaptionStyle,
  type ExportFormat,
  type TimedWord,
} from "@/lib/clips";
import { resolveSourceSegment, isUploadRef, CACHE_DIR } from "@/lib/video-cache";
import { runQueued } from "@/lib/job-queue";
import { watermarkFilter } from "@/lib/watermark";
import { bearerToken, getProfileFromToken, consumeSparksFromToken } from "@/lib/profile-token";
import { getArchivedClip, readArchivedObject } from "@/lib/clip-archive";
import { clipSeekRange } from "@/lib/clip-trim";
import { UPSCALE_COST } from "@/lib/sparks";
import { withCors, corsPreflight } from "@/lib/cors";

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

async function cutClip(
  sourcePath: string,
  startSeconds: number,
  endSeconds: number,
  isPro: boolean,
  format: ExportFormat,
  assPath?: string,
  hookAssPath?: string,
  handle?: string,
  raw = false,
  upscale = false
): Promise<string> {
  const duration = endSeconds - startSeconds;
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
  if (!isPro) {
    vf += `,${watermarkFilter()}`;
  }

  await run(resolveBin("ffmpeg"), [
    "-ss", String(startSeconds),
    "-t", String(duration),
    "-i", sourcePath,
    ...(raw ? [] : ["-vf", vf]),
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
  try {
    const body = await req.json();
    clipId = String(body.clip_id ?? "");
    raw = body.raw === true;
    upscale = body.upscale === true && !raw; // upscale applies to rendered exports only
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

  if (!VOD_URL_PATTERN.test(url) && !isUploadRef(url)) {
    return NextResponse.json({ error: "Invalid VOD URL." }, { status: 400 });
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return NextResponse.json({ error: "Invalid start/end timestamps." }, { status: 400 });
  }
  if (end - start > 180) {
    return NextResponse.json({ error: "Clips are capped at 3 minutes." }, { status: 400 });
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
  const isPro = profile.tier === "pro" && !!profile.stripe_subscription_id;
  const sparksBalance = profile.sparks;

  // Format switching is Pro — free tier always exports the 9:16 default.
  if (!isPro) format = "9:16";

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
  let clipPath: string | null = null;
  let assDir: string | null = null;
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
          // Archive jobs round the source start down to a whole second.
          // Validate against the saved clip, then seek relative to that floor.
          if (start < archived.originalStartSeconds || end > archived.originalEndSeconds) {
            throw new RangeError("Selected trim is outside the saved clip.");
          }
          const bytes = await readArchivedObject(archived.masterPath);
          if (bytes) {
            archivedMaster = path.join(CACHE_DIR, `master-${archived.id}.mp4`);
            await writeFile(archivedMaster, bytes);
            offsetSeconds = Math.floor(archived.originalStartSeconds);
            archivedEndSeconds = archived.originalEndSeconds;
            log("using archived master", archived.masterPath, `${(bytes.byteLength / 1e6).toFixed(1)}MB`);
          } else {
            log("archived master missing, falling back to source", archived.masterPath);
          }
        }
      }

      if (archivedMaster) {
        // The master starts at the ORIGINAL clip start, before the edited trim.
        sourcePath = archivedMaster;
      } else {
        const resolved = await resolveSourceSegment(url, start, end);
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

      let assPath: string | undefined;
      let hookAssPath: string | undefined;
      if ((style && words && words.length > 0) || hook) {
        assDir = await mkdtemp(path.join(tmpdir(), "klyp-ass-"));
      }
      if (style && words && words.length > 0) {
        assPath = path.join(assDir!, "captions.ass");
        const assContent = generateAss(words, start * 1000, end * 1000, style, res);
        await writeFile(assPath, assContent, "utf-8");
      }
      if (hook) {
        hookAssPath = path.join(assDir!, "hook.ass");
        await writeFile(hookAssPath, generateHookAss(hook, res, hookStyle), "utf-8");
      }

      const t2 = Date.now();
      const seek = clipSeekRange(start, end, offsetSeconds, archivedEndSeconds);
      const result = await cutClip(
        sourcePath,
        seek.start,
        seek.end,
        isPro,
        format,
        assPath,
        hookAssPath,
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

    const fileBuffer = await readFile(clipPath);
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
    if (clipPath) rm(clipPath, { force: true }).catch(() => {});
    if (assDir) rm(assDir, { recursive: true, force: true }).catch(() => {});
  }
}
