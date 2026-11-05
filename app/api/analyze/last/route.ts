/**
 * GET /api/analyze/last — the signed-in user's most recent finished analysis that is still inside its retention
 * window (5 days on Free, 30 on Pro), so the Analyze page can offer "Your last analysis is ready" after they
 * left without saving. Only that user's own result is ever returned.
 */
import { NextRequest, NextResponse } from "next/server";
import { bearerToken, getProfileFromToken } from "@/lib/profile-token";
import { createAdminClient } from "@/lib/supabase/admin";
import { planOf } from "@/lib/plan-limits";
import { resultsCutoffIso, resultsDaysLeft, resultsKeptDays } from "@/lib/results-retention";
import { withCors, corsPreflight } from "@/lib/cors";

export const runtime = "nodejs";
export const OPTIONS = corsPreflight;

export async function GET(req: NextRequest) {
  if (process.env.DEPLOYMENT_TARGET !== "processing") return withCors(NextResponse.json({ error: "Not found" }, { status: 404 }));
  const token = bearerToken(req);
  const profile = token ? await getProfileFromToken(token) : null;
  if (!profile) return withCors(NextResponse.json({ error: "Sign in to see your last analysis." }, { status: 401 }));
  const isPro = planOf(profile) === "pro";
  const { data, error } = await createAdminClient().from("analysis_jobs")
    .select("id,source_key,request_payload,result,updated_at")
    .eq("user_id", profile.id).eq("status", "completed").not("result", "is", null)
    .gte("updated_at", resultsCutoffIso(isPro))
    .order("updated_at", { ascending: false }).limit(1);
  if (error) return withCors(NextResponse.json({ error: "Could not load your last analysis." }, { status: 500 }));
  const row = data?.[0] as { id: string; source_key: string; request_payload: { url?: string; uploadId?: string } | null; result: { clips?: { title?: string }[] } | null; updated_at: string } | undefined;
  const clips = row?.result?.clips;
  // An analysis that found nothing has nothing to bring back.
  if (!row || !Array.isArray(clips) || clips.length === 0) return withCors(NextResponse.json({ job: null }));
  const url = row.request_payload?.url || (row.request_payload?.uploadId ? `upload:${row.request_payload.uploadId}` : "");
  return withCors(NextResponse.json({ job: {
    id: row.id, url, sourceKey: row.source_key, completedAt: row.updated_at,
    keptDays: resultsKeptDays(isPro), daysLeft: resultsDaysLeft(row.updated_at, isPro),
    clipCount: clips.length, topTitle: clips[0]?.title ?? null, result: row.result,
  } }));
}
