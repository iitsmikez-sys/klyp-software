/** Private user media for the clip editor. Files are normalized to JPEG or H.264 MP4. */
import { NextRequest, NextResponse } from "next/server";
import { createWriteStream } from "fs";
import { mkdtemp, readFile, rm, stat } from "fs/promises";
import { randomUUID } from "crypto";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { tmpdir } from "os";
import path from "path";
import { resolveBin, run, runCapture } from "@/lib/bin";
import { bearerToken, getProfileFromToken } from "@/lib/profile-token";
import { getArchivedClip, CLIP_BUCKET } from "@/lib/clip-archive";
import { createAdminClient } from "@/lib/supabase/admin";
import { editorMediaPath } from "@/lib/editor-media";
import { withCors, corsPreflight } from "@/lib/cors";

export const runtime = "nodejs";
export const maxDuration = 300;
export const OPTIONS = corsPreflight;

const MAX_BYTES = 50 * 1024 * 1024;
const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"]);
const VIDEO_EXTS = new Set([".mp4", ".mov", ".m4v", ".webm"]);

async function owner(req: NextRequest, clipId: string) {
  const token = bearerToken(req);
  const profile = token ? await getProfileFromToken(token) : null;
  if (!profile) return null;
  const clip = await getArchivedClip(clipId, profile.id);
  return clip ? profile : null;
}

export async function GET(req: NextRequest): Promise<Response> {
  return withCors(await handleGET(req));
}

async function handleGET(req: NextRequest): Promise<Response> {
  if (process.env.DEPLOYMENT_TARGET !== "processing") return NextResponse.json({ error: "Not available." }, { status: 404 });
  const clipId = req.nextUrl.searchParams.get("clip_id") ?? "";
  const id = req.nextUrl.searchParams.get("id") ?? "";
  const kind = req.nextUrl.searchParams.get("kind");
  if (kind !== "image" && kind !== "video") return NextResponse.json({ error: "Invalid media type." }, { status: 400 });
  try {
    const profile = await owner(req, clipId);
    if (!profile) return NextResponse.json({ error: "Clip not found." }, { status: 404 });
    const objectPath = editorMediaPath(profile.id, clipId, id, kind);
    const { data, error } = await createAdminClient().storage.from(CLIP_BUCKET).createSignedUrl(objectPath, 3600);
    if (error || !data) return NextResponse.json({ error: "Imported media is no longer available." }, { status: 404 });
    return NextResponse.json({ url: data.signedUrl });
  } catch {
    return NextResponse.json({ error: "Could not load imported media." }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  return withCors(await handlePOST(req));
}

async function handlePOST(req: NextRequest): Promise<Response> {
  if (process.env.DEPLOYMENT_TARGET !== "processing") return NextResponse.json({ error: "Not available." }, { status: 404 });
  const clipId = req.headers.get("x-clip-id") ?? "";
  let profile;
  try { profile = await owner(req, clipId); }
  catch { return NextResponse.json({ error: "Could not verify clip ownership." }, { status: 500 }); }
  if (!profile) return NextResponse.json({ error: "Clip not found." }, { status: 404 });

  let filename = "";
  try { filename = decodeURIComponent(req.headers.get("x-file-name") ?? ""); }
  catch { return NextResponse.json({ error: "Invalid file name." }, { status: 400 }); }
  const ext = path.extname(filename).toLowerCase();
  const kind = IMAGE_EXTS.has(ext) ? "image" : VIDEO_EXTS.has(ext) ? "video" : null;
  if (!kind) return NextResponse.json({ error: "Use a JPG, PNG, WebP, HEIC, MP4, MOV, or WebM file." }, { status: 400 });
  if (!req.body) return NextResponse.json({ error: "Empty upload." }, { status: 400 });
  if (Number(req.headers.get("content-length")) > MAX_BYTES) {
    return NextResponse.json({ error: "Imported media must be under 50 MB." }, { status: 413 });
  }

  const dir = await mkdtemp(path.join(tmpdir(), "klyp-editor-media-"));
  const input = path.join(dir, `input${ext}`);
  const output = path.join(dir, `output.${kind === "image" ? "jpg" : "mp4"}`);
  try {
    let received = 0;
    const stream = Readable.fromWeb(req.body as import("stream/web").ReadableStream);
    await pipeline((async function* () {
      for await (const chunk of stream) {
        received += (chunk as Buffer).length;
        if (received > MAX_BYTES) throw new Error("Imported media must be under 50 MB.");
        yield chunk;
      }
    })(), createWriteStream(input));
    if (!received) throw new Error("Upload was empty.");

    let duration = 3;
    if (kind === "image") {
      await run(resolveBin("ffmpeg"), ["-v", "error", "-y", "-i", input,
        "-frames:v", "1", "-q:v", "3", output], { maxRunMs: 60_000 });
    } else {
      const probe = await runCapture(resolveBin("ffprobe"), ["-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", input], { maxRunMs: 30_000 });
      const seconds = Number(probe.trim());
      if (!Number.isFinite(seconds) || seconds < 0.1) throw new Error("Could not read the imported video's duration.");
      duration = Math.round(Math.min(30, seconds) * 100) / 100;
      await run(resolveBin("ffmpeg"), ["-v", "error", "-y", "-i", input, "-t", String(duration),
        "-vf", "scale=1080:1920:force_original_aspect_ratio=decrease:force_divisible_by=2",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-movflags", "+faststart", output], { maxRunMs: 4 * 60_000 });
      const outputProbe = await runCapture(resolveBin("ffprobe"), ["-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", output], { maxRunMs: 30_000 });
      duration = Math.round(Math.min(30, Number(outputProbe.trim())) * 100) / 100;
      if (!Number.isFinite(duration) || duration < 0.1) throw new Error("Processed video has no playable duration.");
    }
    if ((await stat(output)).size > MAX_BYTES) throw new Error("Processed media exceeds 50 MB.");
    const id = randomUUID();
    const objectPath = editorMediaPath(profile.id, clipId, id, kind);
    const storage = createAdminClient().storage.from(CLIP_BUCKET);
    const { error } = await storage.upload(objectPath, await readFile(output), {
      contentType: kind === "image" ? "image/jpeg" : "video/mp4", upsert: false,
    });
    if (error) throw new Error(error.message);
    const { data: signed, error: signError } = await storage.createSignedUrl(objectPath, 3600);
    if (signError || !signed) throw new Error("Upload saved but preview could not be opened.");
    return NextResponse.json({ id, kind, duration, name: filename, url: signed.signedUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Media upload failed.";
    return NextResponse.json({ error: message }, { status: message.includes("50 MB") ? 413 : 400 });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
