/**
 * GET /api/health — cheap liveness probe for the processing service.
 * No auth, no work — the frontend polls this to detect the dev server going
 * down (or Railway restarting it) and to know automatically when it's back.
 */
import { NextResponse } from "next/server";
import { withCors, corsPreflight } from "@/lib/cors";

export const runtime = "nodejs";
export const OPTIONS = corsPreflight;

export async function GET() {
  return withCors(NextResponse.json({ ok: true, deploymentTarget: process.env.DEPLOYMENT_TARGET ?? null }));
}
