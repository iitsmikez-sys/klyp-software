/**
 * GET /api/duration?url=... — probe a VOD's duration (no download).
 *
 * Used by the dashboard to preview the Sparks cost before analysis.
 * yt-dlp reads just the metadata (--skip-download), typically 1-3s.
 * Results are cached in-memory per URL (see lib/probe-duration.ts, which
 * /api/analyze also uses so the quote and the charge measure the same way).
 * (YouTube's oEmbed API doesn't return duration, so yt-dlp is the reliable
 * cross-platform option.)
 */
import { NextRequest, NextResponse } from "next/server";
import { exceedsMaxDuration, MAX_VOD_SECONDS } from "@/lib/duration-limits";
import { DurationError, probeUrlDuration } from "@/lib/probe-duration";
import { estimateSparks } from "@/lib/sparks";
import { withCors, corsPreflight } from "@/lib/cors";

export const runtime = "nodejs";
export const maxDuration = 30;

export const OPTIONS = corsPreflight;

const VOD_URL_PATTERN =
  /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|twitch\.tv\/videos\/|m\.twitch\.tv\/videos\/)/i;

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

  let durationSeconds: number;
  try {
    durationSeconds = await probeUrlDuration(url);
  } catch (err) {
    return withCors(
      NextResponse.json(
        { error: err instanceof Error ? err.message : "Could not read video duration." },
        { status: err instanceof DurationError ? err.status : 500 }
      )
    );
  }

  return withCors(
    NextResponse.json({
      durationSeconds,
      sparks: estimateSparks(durationSeconds),
      // /api/analyze refuses these; exposed so the UI can say so before the run.
      tooLong: exceedsMaxDuration(durationSeconds),
      maxSeconds: MAX_VOD_SECONDS,
    })
  );
}
