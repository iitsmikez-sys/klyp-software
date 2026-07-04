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

export const runtime = "nodejs";
export const maxDuration = 300;

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
  ]);

  return outPath;
}

export async function POST(req: NextRequest) {
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

  let previewPath: string | null = null;
  try {
    const sourcePath = await resolveSource(url);
    previewPath = await cutPreview(sourcePath, start, end);

    const fileBuffer = await readFile(previewPath);
    return new NextResponse(fileBuffer, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(fileBuffer.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Preview generation failed." },
      { status: 500 }
    );
  } finally {
    if (previewPath) rm(previewPath, { force: true }).catch(() => {});
  }
}
