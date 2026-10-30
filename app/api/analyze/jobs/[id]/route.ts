import { NextRequest, NextResponse } from "next/server";
import { bearerToken, getProfileFromToken } from "@/lib/profile-token";
import { getAnalysisJob } from "@/lib/analysis-jobs";
import { withCors, corsPreflight } from "@/lib/cors";

export const runtime = "nodejs";
export const OPTIONS = corsPreflight;

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (process.env.DEPLOYMENT_TARGET !== "processing") return withCors(NextResponse.json({ error: "Not found" }, { status: 404 }));
  const token = bearerToken(req);
  const profile = token ? await getProfileFromToken(token) : null;
  if (!profile) return withCors(NextResponse.json({ error: "Sign in to view this analysis." }, { status: 401 }));
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return withCors(NextResponse.json({ error: "Invalid job ID." }, { status: 400 }));
  const job = await getAnalysisJob(profile.id, id);
  if (!job) return withCors(NextResponse.json({ error: "Analysis job not found." }, { status: 404 }));
  return withCors(NextResponse.json({ jobId: job.id, status: job.status, stage: job.stage,
    error: job.error, result: job.result, updatedAt: job.heartbeat_at ?? job.created_at }));
}
