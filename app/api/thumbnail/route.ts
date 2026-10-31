/**
 * POST /api/thumbnail — a still frame from INSIDE a clip's own time range.
 *
 * Clip cards used to show the source VOD's cover image, which meant every clip
 * cut from one stream displayed an identical picture regardless of what the
 * moment actually was. This extracts a frame between the clip's own start and
 * end instead, so two clips from the same VOD never look alike.
 *
 * Shares /api/preview's machinery: the same slice-only download
 * (resolveSourceSegment), the same job queue, the same Bearer auth. A frame is
 * far cheaper than a preview cut — one seek, one JPEG, no encode of a whole
 * segment — and repeat requests are served straight off disk.
 */
import { NextRequest, NextResponse } from "next/server";
import { readFile, stat } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { createHash } from "crypto";
import { resolveBin, run } from "@/lib/bin";
import { resolveSourceSegment, isUploadRef, CACHE_DIR } from "@/lib/video-cache";
import { runQueued } from "@/lib/job-queue";
import { bearerToken, getProfileFromToken } from "@/lib/profile-token";
import { withCors, corsPreflight } from "@/lib/cors";
import { getArchivedClip, readArchivedObject } from "@/lib/clip-archive";
import { canProcessClip, acquireUserProcessingSlot } from "@/lib/clip-access";

export const runtime = "nodejs";
export const maxDuration = 300;

export const OPTIONS = corsPreflight;

/**
 * Bump to invalidate every cached frame at once — e.g. if the crop, size or
 * frame-choice rule below changes and old images would no longer match.
 */
const THUMB_VERSION = "v1";

/** 16:9 at a size that stays sharp on a 2x display at the card's width. */
const THUMB_WIDTH = 640;
const THUMB_HEIGHT = 360;

const VOD_URL_PATTERN =
  /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|twitch\.tv\/videos\/|m\.twitch\.tv\/videos\/)/i;

/**
 * Cache identity for one clip's frame: the source, the exact range, and the
 * output version — never the VOD alone, which is precisely the bug this route
 * fixes. Two clips from one VOD hash differently because their ranges differ.
 */
function thumbCacheKey(url: string, start: number, end: number): string {
  const source = createHash("sha1").update(url).digest("hex").slice(0, 16);
  return `thumb-${THUMB_VERSION}-${source}-${Math.floor(start)}-${Math.ceil(end)}`;
}

/** Midpoint of the clip — inside the range by construction, and past whatever
 *  lead-in the clip starts with. */
function frameTime(start: number, end: number): number {
  return start + (end - start) / 2;
}

async function extractFrame(
  sourcePath: string,
  seekSeconds: number,
  outPath: string
): Promise<void> {
  await run(
    resolveBin("ffmpeg"),
    [
      // -ss before -i seeks by keyframe: near-instant, and a keyframe within a
      // second of the target is still unmistakably this moment.
      "-ss", String(Math.max(0, seekSeconds)),
      "-i", sourcePath,
      "-frames:v", "1",
      "-vf", `scale=${THUMB_WIDTH}:${THUMB_HEIGHT}:force_original_aspect_ratio=increase,crop=${THUMB_WIDTH}:${THUMB_HEIGHT}`,
      "-q:v", "4",
      "-y",
      outPath,
    ],
    { stallTimeoutMs: 30_000, maxRunMs: 2 * 60_000 }
  );
}

export async function POST(req: NextRequest): Promise<Response> {
  return withCors(await handlePOST(req));
}

async function handlePOST(req: NextRequest): Promise<Response> {
  if (process.env.DEPLOYMENT_TARGET !== "processing") {
    return NextResponse.json({ error: "This endpoint only runs on the processing service." }, { status: 404 });
  }

  let url: string, start: number, end: number, clipId: string;
  try {
    const body = await req.json();
    clipId = String(body.clip_id ?? "");
    url = String(body.url ?? "").trim();
    start = Number(body.start_seconds);
    end = Number(body.end_seconds);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!VOD_URL_PATTERN.test(url) && !isUploadRef(url)) {
    return NextResponse.json({ error: "Invalid VOD URL." }, { status: 400 });
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 180) {
    return NextResponse.json({ error: "Invalid timestamps." }, { status: 400 });
  }

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
    return NextResponse.json({ error: "You must be signed in to load clip thumbnails." }, { status: 401 });
  }
  try {
    if (!await canProcessClip(profile.id, clipId, url, start, end)) {
      return NextResponse.json({ error: "This clip is not in your saved clips or analysis results." }, { status: 403 });
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Clip access check failed." }, { status: 500 });
  }

  // Archived poster first: already this clip's frame, and it outlives the
  // source VOD. Scoped to the caller's own id inside getArchivedClip.
  if (clipId) {
    const archived = await getArchivedClip(clipId, profile.id);
    if (archived?.posterPath && archived.status === "stored") {
      const bytes = await readArchivedObject(archived.posterPath, archived.provider);
      if (bytes) {
        return new NextResponse(new Uint8Array(bytes), {
          headers: {
            "Content-Type": "image/jpeg",
            "Content-Length": String(bytes.byteLength),
            "Cache-Control": "private, max-age=86400",
            "X-Klyp-Source": "archive",
          },
        });
      }
    }
  }

  const outPath = path.join(CACHE_DIR, `${thumbCacheKey(url, start, end)}.jpg`);

  const serve = async () => {
    const buffer = await readFile(outPath);
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(buffer.byteLength),
        // Keyed by range + version, so a hit is always this clip's frame.
        "Cache-Control": "private, max-age=86400",
      },
    });
  };

  // Cache hit: no download, no queue slot, no ffmpeg.
  if (existsSync(outPath) && (await stat(outPath)).size > 0) return serve();

  const reqId = Math.random().toString(36).slice(2, 8);
  const releaseSlot = acquireUserProcessingSlot(profile.id);
  if (!releaseSlot) return NextResponse.json({ error: "Too many clip requests are processing. Try again shortly." }, { status: 429 });
  try {
    await runQueued(`thumbnail:${reqId}`, async () => {
      // Another request for the same clip may have produced it while this one
      // waited for a queue slot.
      if (existsSync(outPath) && (await stat(outPath)).size > 0) return;
      // Share the preview's 480p segment. The older 360p cache on Railway
      // included audio-only MP4s that cannot produce a still frame.
      const { path: sourcePath, offsetSeconds } = await resolveSourceSegment(url, start, end, 480, 10 * 60_000, profile.id);
      await extractFrame(sourcePath, frameTime(start, end) - offsetSeconds, outPath);
    });
    return serve();
  } catch (err) {
    // The card falls back to its placeholder — never to another clip's image.
    const message = err instanceof Error ? err.message : "Thumbnail generation failed.";
    console.log(`[thumbnail ${reqId}] FAILED:`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    releaseSlot();
  }
}
