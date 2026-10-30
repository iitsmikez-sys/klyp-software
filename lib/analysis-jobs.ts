import { createHash, randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { tokenClient } from "@/lib/profile-token";
import type { ClipWithWords, AnalyzeEvent } from "@/lib/clips";
import type { ClipCount } from "@/lib/sparks";

export type AnalysisJob = {
  id: string; user_id: string; source_key: string; input_hash: string;
  status: "queued" | "running" | "completed" | "failed";
  stage: "download" | "transcribe" | "analyze";
  error: string | null; analysis_clips: ClipWithWords[] | null;
  analysis_duration_seconds: number | null; transcript_chars: number | null;
  result: AnalyzeEvent | null; run_token: string | null;
  heartbeat_at: string | null; created_at: string;
};

const db = () => createAdminClient();
export function analysisInputHash(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}
export function isAnalysisJobStale(job: AnalysisJob): boolean {
  return job.status === "running" && (!job.heartbeat_at || !Number.isFinite(Date.parse(job.heartbeat_at)) || Date.now() - Date.parse(job.heartbeat_at) > 4 * 60_000);
}
export async function getAnalysisJob(userId: string, jobId: string): Promise<AnalysisJob | null> {
  const { data, error } = await db().from("analysis_jobs").select("*").eq("user_id", userId).eq("id", jobId).maybeSingle();
  if (error) throw new Error(`Could not load analysis job: ${error.message}`);
  return data as AnalysisJob | null;
}
export async function createOrLoadAnalysisJob(userId: string, jobId: string, sourceKey: string, input: unknown): Promise<AnalysisJob> {
  const inputHash = analysisInputHash(input);
  const existing = await getAnalysisJob(userId, jobId);
  if (existing) {
    if (existing.input_hash !== inputHash || existing.source_key !== sourceKey) throw new Error("This analysis job ID belongs to different settings.");
    return existing;
  }
  const { error } = await db().from("analysis_jobs").insert({ id: jobId, user_id: userId, source_key: sourceKey, input_hash: inputHash, request_payload: input });
  if (error?.code === "23505") {
    const active = await findActiveAnalysisJob(userId, sourceKey, inputHash);
    if (active) return active;
  }
  if (error) throw new Error(`Could not create analysis job: ${error.message}`);
  const job = await getAnalysisJob(userId, jobId);
  if (!job || job.input_hash !== inputHash) throw new Error("This analysis job ID is already in use.");
  return job;
}
export async function findActiveAnalysisJob(userId: string, sourceKey: string, inputHash: string): Promise<AnalysisJob | null> {
  const { data, error } = await db().from("analysis_jobs").select("*").eq("user_id", userId)
    .eq("source_key", sourceKey).eq("input_hash", inputHash).in("status", ["queued", "running"])
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`Could not check active analyses: ${error.message}`);
  return data as AnalysisJob | null;
}
export async function claimAnalysisJob(job: AnalysisJob): Promise<string | null> {
  const runToken = randomUUID();
  const stale = isAnalysisJobStale(job);
  if (job.status === "running" && !stale) return null;
  if (job.status === "completed") return null;
  const query = db().from("analysis_jobs").update({ status: "running", run_token: runToken,
    heartbeat_at: new Date().toISOString(), updated_at: new Date().toISOString(), error: null,
    attempts: ((job as AnalysisJob & { attempts?: number }).attempts ?? 0) + 1 })
    .eq("id", job.id).eq("user_id", job.user_id).eq("status", job.status);
  const { data, error } = await (job.status === "running" ? query.eq("run_token", job.run_token) : query).select("id").maybeSingle();
  if (error) throw new Error(`Could not claim analysis job: ${error.message}`);
  return data ? runToken : null;
}
export async function checkpointAnalysisJob(jobId: string, runToken: string, changes: Record<string, unknown>) {
  const { data, error } = await db().from("analysis_jobs").update({ ...changes, heartbeat_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", jobId).eq("run_token", runToken).eq("status", "running").select("id").maybeSingle();
  if (error || !data) throw new Error(`Could not checkpoint analysis job: ${error?.message ?? "attempt superseded"}`);
}
export async function failAnalysisJob(jobId: string, runToken: string, message: string) {
  await checkpointAnalysisJob(jobId, runToken, { status: "failed", error: message });
}
export async function accountAnalysisJob(token: string, jobId: string, runToken: string, clips: ClipWithWords[], durationSeconds: number, clipCount: ClipCount): Promise<AnalyzeEvent> {
  const { data, error } = await tokenClient(token).rpc("record_analysis_job_clips", {
    p_job_id: jobId, p_run_token: runToken, p_clips: clips,
    p_duration_seconds: durationSeconds, p_requested_clips: clipCount,
  });
  if (error) throw new Error(`Could not save or charge clips: ${error.message}`);
  return data as AnalyzeEvent;
}
