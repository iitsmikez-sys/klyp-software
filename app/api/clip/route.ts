/**
 * POST /api/clip — Klyp's clipping pipeline, stage 2 (the cutter).
 *
 * Takes a VOD URL + one clip's timestamps (from /api/analyze) and returns the
 * actual MP4:
 *   1. Download the full video with yt-dlp (cached per-URL, shared with /api/preview)
 *   2. Cut start→end with FFmpeg, center-crop to 9:16 vertical, 1080×1920
 *   3. Burn captions (if style + words provided)
 *   4. Burn animated watermark (free tier only)
 *   5. Stream the MP4 back as a file download
 */
import { NextRequest, NextResponse } from "next/server";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { resolveBin, run } from "@/lib/bin";
import { generateAss, generateHookAss, toFfmpegPath, HOOK_STYLES, type HookStyle } from "@/lib/captions";
import {
  CAPTION_STYLES,
  EXPORT_FORMATS,
  FORMAT_DIMENSIONS,
  type CaptionStyle,
  type ExportFormat,
  type TimedWord,
} from "@/lib/clips";
import { resolveSource, isUploadRef, CACHE_DIR } from "@/lib/video-cache";
import { watermarkFilter } from "@/lib/watermark";
import { getProfile, consumeSparks } from "@/lib/profile";
import { UPSCALE_COST } from "@/lib/sparks";

export const runtime = "nodejs";
export const maxDuration = 300;

const VOD_URL_PATTERN =
  /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|twitch\.tv\/videos\/|m\.twitch\.tv\/videos\/)/i;

/**
 * Static streamer-handle overlay, top-right corner. The handle is validated
 * to [A-Za-z0-9_] before it reaches this filter, so no drawtext escaping issues.
 */
function handleFilter(handle: string): string {
  return [
    `drawtext=text='@${handle}'`,
    `font='Arial Bold'`,
    `fontsize=44`,
    `fontcolor=white@0.85`,
    `shadowcolor=black@0.6`,
    `shadowx=2`,
    `shadowy=2`,
    `x=main_w-tw-28`,
    `y=96`,
  ].join(":");
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
  let { w, h } = FORMAT_DIMENSIONS[format];
  if (upscale) {
    w *= 2;
    h *= 2;
  }
  let vf = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`;
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
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "+faststart",
    "-y",
    outPath,
  ]);

  return outPath;
}

function sanitizeFilename(title: string): string {
  const safe = title.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_").slice(0, 60);
  return (safe || "klyp_clip") + ".mp4";
}

export async function POST(req: NextRequest) {
  let url: string, start: number, end: number, title: string;
  let style: CaptionStyle | undefined;
  let words: TimedWord[] | undefined;
  let handle: string | undefined;
  let format: ExportFormat = "9:16";
  let hook: string | undefined;
  let hookStyle: HookStyle = "CLASSIC";
  let raw = false;
  let upscale = false;
  try {
    const body = await req.json();
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

  // Watermark decision is server-side: only a signed-in Pro user skips it.
  let isPro = false;
  let sparksBalance: number | null = null;
  try {
    const profile = await getProfile();
    isPro = profile?.tier === "pro";
    sparksBalance = profile?.sparks ?? null;
  } catch {
    // Profile lookup failing should never block an export — default to watermark.
  }

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

  let clipPath: string | null = null;
  let assDir: string | null = null;
  try {
    const sourcePath = await resolveSource(url);
    const dims = FORMAT_DIMENSIONS[format];
    // ASS PlayRes must match the output resolution so burned text scales with it.
    const res = upscale ? { w: dims.w * 2, h: dims.h * 2 } : dims;

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

    clipPath = await cutClip(sourcePath, start, end, isPro, format, assPath, hookAssPath, handle, raw, upscale);

    // Charge for the upscale only after the render succeeded.
    if (upscale) {
      await consumeSparks(UPSCALE_COST);
    }

    const fileBuffer = await readFile(clipPath);
    return new NextResponse(fileBuffer, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(fileBuffer.byteLength),
        "Content-Disposition": `attachment; filename="${sanitizeFilename(title)}"`,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Clip generation failed." },
      { status: 500 }
    );
  } finally {
    if (clipPath) rm(clipPath, { force: true }).catch(() => {});
    if (assDir) rm(assDir, { recursive: true, force: true }).catch(() => {});
  }
}
