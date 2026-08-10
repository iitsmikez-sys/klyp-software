/**
 * GET /api/duration?url=... — probe a VOD's duration (no download).
 *
 * Used by the dashboard to preview the Sparks cost before analysis.
 * yt-dlp reads just the metadata (--skip-download), typically 1-3s.
 * Results are cached in-memory per URL. (YouTube's oEmbed API doesn't
 * return duration, so yt-dlp is the reliable cross-platform option.)
 */
import { NextRequest, NextResponse } from "next/server";
import { resolveBin, runCapture } from "@/lib/bin";
import { estimateSparks } from "@/lib/sparks";
import { withCors, corsPreflight } from "@/lib/cors";

export const runtime = "nodejs";
export const maxDuration = 30;

export const OPTIONS = corsPreflight;

const VOD_URL_PATTERN =
  /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|twitch\.tv\/videos\/|m\.twitch\.tv\/videos\/)/i;

const durationCache = new Map<string, number>();

export async function GET(req: NextRequest) {
  // This route only runs on the processing service — set DEPLOYMENT_TARGET
  // there (and in local dev's .env.local, where one server plays both roles).
  if (process.env.DEPLOYMENT_TARGET !== "processing") {
    return withCors(
      NextResponse.json({ error: "This endpoint only runs on the processing service." }, { status: 404 })
    );
  }

  const url = (req.nextUrl.searchParams.get("url") ?? "").trim();

  if (!VOD_URL_PATTERN.test(url)) {
    return withCors(NextResponse.json({ error: "Invalid VOD URL." }, { status: 400 }));
  }

  let durationSeconds = durationCache.get(url);

  if (durationSeconds === undefined) {
    try {
      const out = await runCapture(resolveBin("yt-dlp"), [
        "--print", "duration",
        "--skip-download",
        "--no-playlist",
        url,
      ]);
      durationSeconds = Math.round(parseFloat(out.trim()));
      if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
        throw new Error("No duration in metadata (is this a live stream?).");
      }
      durationCache.set(url, durationSeconds);
    } catch (err) {
      return withCors(
        NextResponse.json(
          { error: err instanceof Error ? err.message : "Could not read video duration." },
          { status: 500 }
        )
      );
    }
  }

  return withCors(
    NextResponse.json({
      durationSeconds,
      sparks: estimateSparks(durationSeconds),
    })
  );
}
