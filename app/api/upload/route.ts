/**
 * POST /api/upload — receive a local VOD file for analysis.
 *
 * The client sends the raw file bytes as the request body (streamed to disk,
 * never buffered in memory) with the original name in the x-file-name header.
 * The file lands in CACHE_DIR as upload-<uuid>.<ext> and is referenced by the
 * rest of the pipeline as "upload:<uuid>" wherever a VOD URL is expected.
 *
 * Responds with { uploadId, durationSeconds, sparks } so the client can show
 * the cost estimate before analyzing.
 *
 * NOTE: Like /api/analyze this spawns ffprobe and needs local disk — dev /
 * Node server only, not Vercel serverless.
 */
import { NextRequest, NextResponse } from "next/server";
import { createWriteStream } from "fs";
import { mkdir, rm } from "fs/promises";
import { randomUUID } from "crypto";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import path from "path";
import { resolveBin, runCapture } from "@/lib/bin";
import { CACHE_DIR } from "@/lib/video-cache";
import { bearerToken, getProfileFromToken } from "@/lib/profile-token";
import { estimateSparks } from "@/lib/sparks";
import { withCors, corsPreflight } from "@/lib/cors";

export const runtime = "nodejs";
export const maxDuration = 300;

export const OPTIONS = corsPreflight;

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024; // 4 GB — keep in sync with AnalyzePanel
const ALLOWED_EXTS = new Set([".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"]);
const TOO_LARGE_MSG = "File too large — use a URL instead or trim your VOD first.";

export async function POST(req: NextRequest): Promise<Response> {
  return withCors(await handlePOST(req));
}

async function handlePOST(req: NextRequest): Promise<Response> {
  // This route only runs on the processing service — set DEPLOYMENT_TARGET
  // there (and in local dev's .env.local, where one server plays both roles).
  if (process.env.DEPLOYMENT_TARGET !== "processing") {
    return NextResponse.json({ error: "This endpoint only runs on the processing service." }, { status: 404 });
  }

  // Uploads are for signed-in users only — same gate as analysis, verified
  // via Bearer token (not cookies — this service is on a different origin
  // than the frontend that calls it).
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
    return NextResponse.json({ error: "You must be signed in to upload a VOD." }, { status: 401 });
  }

  const filename = decodeURIComponent(req.headers.get("x-file-name") ?? "");
  const ext = path.extname(filename).toLowerCase();
  if (!ALLOWED_EXTS.has(ext)) {
    return NextResponse.json(
      { error: "Unsupported file type — upload an MP4, MOV, or AVI video." },
      { status: 400 }
    );
  }

  const declaredSize = Number(req.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: TOO_LARGE_MSG }, { status: 413 });
  }
  if (!req.body) {
    return NextResponse.json({ error: "Empty request body." }, { status: 400 });
  }

  const uploadId = randomUUID();
  const outPath = path.join(CACHE_DIR, `upload-${uploadId}${ext}`);

  try {
    await mkdir(CACHE_DIR, { recursive: true });

    // Stream to disk, enforcing the size cap on actual bytes (the
    // content-length header can lie).
    let received = 0;
    const body = Readable.fromWeb(req.body as import("stream/web").ReadableStream);
    const capped = async function* () {
      for await (const chunk of body) {
        received += (chunk as Buffer).length;
        if (received > MAX_UPLOAD_BYTES) throw new Error(TOO_LARGE_MSG);
        yield chunk;
      }
    };
    await pipeline(capped, createWriteStream(outPath));

    if (received === 0) {
      throw new Error("Upload was empty.");
    }

    // Probe duration so the client can preview the Sparks cost.
    const probed = await runCapture(resolveBin("ffprobe"), [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      outPath,
    ]);
    const durationSeconds = Math.round(Number(probed.trim()));
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new Error("Could not read the video's duration — is the file a valid video?");
    }

    return NextResponse.json({
      uploadId,
      durationSeconds,
      sparks: estimateSparks(durationSeconds),
    });
  } catch (err) {
    rm(outPath, { force: true }).catch(() => {});
    const message = err instanceof Error ? err.message : "Upload failed.";
    return NextResponse.json({ error: message }, { status: message === TOO_LARGE_MSG ? 413 : 500 });
  }
}
