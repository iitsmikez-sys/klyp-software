import { createAdminClient } from "@/lib/supabase/admin";

/** Analyses one account may start per rolling hour. */
export const MAX_ANALYSES_PER_HOUR = (() => {
  const n = Number(process.env.KLYP_MAX_ANALYSES_PER_HOUR);
  return Number.isInteger(n) && n > 0 ? n : 10;
})();

/**
 * How many analyses this user has actually STARTED in the last hour. Jobs that
 * were only created (never claimed, attempts = 0) do not count, so a refused or
 * abandoned request does not use up the allowance. A retry of the same job is
 * the same row and counts once.
 */
export async function startedAnalysesLastHour(userId: string, now: number = Date.now()): Promise<number> {
  const since = new Date(now - 60 * 60_000).toISOString();
  const { count, error } = await createAdminClient()
    .from("analysis_jobs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gt("attempts", 0)
    .gte("created_at", since);
  if (error) throw new Error(`Could not count recent analyses: ${error.message}`);
  return count ?? 0;
}
