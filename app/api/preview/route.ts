/**
 * POST /api/preview — fast preview clip for the dashboard player.
 *
 * Same pipeline as /api/clip but:
 *   - Half resolution (540×960) for speed
 *   - ultrafast preset + higher CRF — visual quality doesn't matter here
 *   - No captions or watermark (canvas overlay handles those in the browser)
 *   - Returns MP4 directly (no attachment header — played inline)
 *
 * First call may be slow if the source video isn't cached yet (triggers full
 * VOD download). Subsequent calls for the same VOD are fast (~5–10s).
 */
import { NextRequest, NextResponse } from "next/server";
import { rm, readFile } from "fs/promises";
import path from "path";
import { resolveBin, run } from "@/lib/bin";
import { resolveSource, isUploadRef, CACHE_DIR } from "@/lib/video-cache";
import { bearerToken, getProfileFromToken } from "@/lib/profile-token";
import { withCors, corsPreflight } from "@/lib/cors";

export const runtime = "nodejs";
export const maxDuration = 300;

export const OPTIONS = corsPreflight;

const VOD_URL_PATTERN =
  /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|twitch\.tv\/videos\/|m\.twitch\.tv\/videos\/)/i;

async function cutPreview(
  sourcePath: string,
  startSeconds: number,
  endSeconds: number
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
    "-vf", "scale=540:960:force_original_aspect_ratio=increase,crop=540:960",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-crf", "30",
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

  let url: string, start: number, end: number;
  try {
    const body = await req.json();
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

  log("start", url.slice(0, 100), `${start}-${end}s`);
  let previewPath: string | null = null;
  try {
    const t0 = Date.now();
    const sourcePath = await resolveSource(url);
    log("source resolved in", `${((Date.now() - t0) / 1000).toFixed(1)}s`);

    const t1 = Date.now();
    previewPath = await cutPreview(sourcePath, start, end);
    log("preview cut in", `${((Date.now() - t1) / 1000).toFixed(1)}s`);

    const fileBuffer = await readFile(previewPath);
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
    if (previewPath) rm(previewPath, { force: true }).catch(() => {});
  }
}
