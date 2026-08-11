/**
 * GET /api/queue-status — debug visibility into the processing job queue
 * (lib/job-queue.ts). Not sensitive (aggregate counts only, no per-user
 * data), so no auth — same as /api/health.
 */
import { NextResponse } from "next/server";
import { queueStatus } from "@/lib/job-queue";
import { withCors, corsPreflight } from "@/lib/cors";

export const runtime = "nodejs";

export const OPTIONS = corsPreflight;

export async function GET() {
  if (process.env.DEPLOYMENT_TARGET !== "processing") {
    return withCors(
      NextResponse.json({ error: "This endpoint only runs on the processing service." }, { status: 404 })
    );
  }
  return withCors(NextResponse.json(queueStatus()));
}
