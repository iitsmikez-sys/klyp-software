/**
 * POST /api/preview — fast preview clip for the dashboard player.
 *
 * Same pipeline as /api/clip but:
 *   - Half resolution (540×960) for speed
 *   - ultrafast preset + higher CRF — visual quality doesn't matter here
 *   - No captions or watermark (canvas overlay handles those in the browser)
 *   - Returns MP4 directly (no attachment header — played inline)
 *
 * Only the needed slice of the source is downloaded (see resolveSourceSegment)
 * — previewing a 30s clip from a 10.9h VOD fetches ~15MB rather than the ~36GB
 * full source, which is what used to make the first preview take minutes.
 * Repeat previews of the same range hit the segment cache.
 */
import { NextRequest, NextResponse } from "next/server";
import { rm, readFile } from "fs/promises";
import path from "path";
import { resolveBin, run, FFMPEG_THREADS } from "@/lib/bin";
import { resolveSourceSegment, isUploadRef, CACHE_DIR } from "@/lib/video-cache";
import { runQueued } from "@/lib/job-queue";
import { bearerToken, getProfileFromToken } from "@/lib/profile-token";
import { withCors, corsPreflight } from "@/lib/cors";
import { getArchivedClip, readArchivedObject } from "@/lib/clip-archive";
import { canProcessClip, acquireUserProcessingSlot } from "@/lib/clip-access";

export const runtime = "nodejs";
export const maxDuration = 300;

export const OPTIONS = corsPreflight;

const VOD_URL_PATTERN =
  /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|twitch\.tv\/videos\/|m\.twitch\.tv\/videos\/)/i;

async function cutPreview(
  sourcePath: string,
  startSeconds: number,
  endSeconds: number,
  /**
   * False keeps the source's own aspect ratio (capped to 720p tall) instead of
   * cropping to 9:16. The clip modal shows the moment as it was streamed —
   * cropping a 16:9 gameplay clip to vertical there would hide most of the
   * frame. The 9:16 crop stays the default: the caption/hook overlays in
   * ClipPreview and SavedClipEditor are positioned for a vertical frame, and
   * it mirrors what a 9:16 export produces.
   */
  crop: boolean
): Promise<string> {
  const duration = endSeconds - startSeconds;
  const outPath = path.join(
    CACHE_DIR,
    `preview-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`
  );

  await run(resolveBin("ffmpeg"), [
    "-ss", String(startSeconds),
    "-t", String(duration),
    "-i", sourcePath,
    // Half resolution — fast to encode, still looks fine in the player.
    // -2 keeps the computed side even, which libx264 requires.
    "-vf", crop
      ? "scale=540:960:force_original_aspect_ratio=increase,crop=540:960"
      : "scale=-2:720:force_original_aspect_ratio=decrease",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-crf", "30",
    "-threads", String(FFMPEG_THREADS),
    "-c:a", "aac",
    "-b:a", "64k",
    "-movflags", "+faststart",
    "-y",
    outPath,
  ],
  // ffmpeg prints progress to stderr continuously — silence means it's wedged.
  { stallTimeoutMs: 30_000, maxRunMs: 5 * 60_000 });

  return outPath;
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
  const log = (...args: unknown[]) => console.log(`[preview ${reqId}]`, new Date().toISOString(), ...args);

  let url: string, start: number, end: number, crop: boolean, clipId: string;
  try {
    const body = await req.json();
    clipId = String(body.clip_id ?? "");
    url = String(body.url ?? "").trim();
    start = Number(body.start_seconds);
    end = Number(body.end_seconds);
    // Existing callers send no "crop" and keep the 9:16 behaviour they expect.
    crop = body.crop !== false;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!VOD_URL_PATTERN.test(url) && !isUploadRef(url)) {
    return NextResponse.json({ error: "Invalid VOD URL." }, { status: 400 });
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 180) {
    return NextResponse.json({ error: "Invalid timestamps." }, { status: 400 });
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
    return NextResponse.json({ error: "You must be signed in to preview clips." }, { status: 401 });
  }
  try {
    if (!await canProcessClip(profile.id, clipId, url, start, end)) {
      return NextResponse.json({ error: "This clip is not in your saved clips or analysis results." }, { status: 403 });
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Clip access check failed." }, { status: 500 });
  }

  // Archived proxy first. It is already this exact clip cut to 540p, so there
  // is nothing to download or encode — and crucially it still works when the
  // source VOD has been deleted, which is the whole point of archiving.
  // Scoped to the caller's own id inside getArchivedClip.
  if (clipId) {
    const archived = await getArchivedClip(clipId, profile.id);
    if (archived?.proxyPath && archived.status === "stored") {
      const bytes = await readArchivedObject(archived.proxyPath);
      if (bytes) {
        log("served archived proxy", archived.proxyPath, `${(bytes.byteLength / 1e6).toFixed(1)}MB`);
        return new NextResponse(new Uint8Array(bytes), {
          headers: {
            "Content-Type": "video/mp4",
            "Content-Length": String(bytes.byteLength),
            "Cache-Control": "private, max-age=3600",
            "X-Klyp-Source": "archive",
          },
        });
      }
      log("archived proxy missing, falling back to source", archived.proxyPath);
    }
  }

  log("start", url.slice(0, 100), `${start}-${end}s`, crop ? "9:16" : "source-aspect");
  const releaseSlot = acquireUserProcessingSlot(profile.id);
  if (!releaseSlot) return NextResponse.json({ error: "Too many clip requests are processing. Try again shortly." }, { status: 429 });
  let previewPath: string | null = null;
  try {
    const t0 = Date.now();
    // Concurrency-capped: the download (yt-dlp) + encode (ffmpeg) below are
    // the actual CPU/memory-heavy work — the response streaming after it is
    // cheap I/O and stays outside the queued slot.
    previewPath = await runQueued(`preview:${reqId}`, async () => {
      // Fetch only the slice this preview needs, not the whole VOD. The returned
      // offset is where that slice begins in the original timeline, so the cut
      // below must seek relative to it (a segment file starts at 0).
      // 480p is plenty of source to downscale from — see resolveSourceSegment's
      // maxHeight doc for why fetching full 1080p here just wastes time.
      const { path: sourcePath, offsetSeconds } = await resolveSourceSegment(url, start, end, 480);
      log("source resolved in", `${((Date.now() - t0) / 1000).toFixed(1)}s`, `offset=${offsetSeconds}s`);

      const t1 = Date.now();
      const result = await cutPreview(sourcePath, start - offsetSeconds, end - offsetSeconds, crop);
      log("preview cut in", `${((Date.now() - t1) / 1000).toFixed(1)}s`);
      return result;
    });

    const fileBuffer = await readFile(/* turbopackIgnore: true */ previewPath);
    log("done, total", `${((Date.now() - t0) / 1000).toFixed(1)}s`, `${(fileBuffer.byteLength / 1e6).toFixed(1)}MB`);
    return new NextResponse(fileBuffer, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(fileBuffer.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Preview generation failed.";
    log("FAILED:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    releaseSlot();
    if (previewPath) rm(previewPath, { force: true }).catch(() => {});
  }
}
