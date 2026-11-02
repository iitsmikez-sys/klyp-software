/**
 * Free-plan daily capacity breaker.
 *
 * A Free account's 60 Sparks buy at most one long (e.g. 4-hour YouTube) analysis a month, so
 * one account's exposure is already small. The risk is many throwaway accounts. This caps the
 * ESTIMATED provider cost of all Free long runs started in a UTC day; once it is reached,
 * Free analyses longer than an hour are paused until tomorrow. Short Free runs and every Pro
 * run are never affected. It changes neither Spark prices nor the per-run $3 provider budget.
 *
 * Needs migration 037 (analysis_jobs.plan_at_start / est_cost_micro_usd). Until that is applied
 * the breaker is off: a missing column is treated as "unavailable" and the run proceeds.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { projectedRunUsd } from "@/lib/vod-budget";
import type { PlanName } from "@/lib/plan-limits";

/** Free analyses longer than this count against the daily capacity. */
export const FREE_LONG_RUN_SECONDS = 3600;

/** Daily Free long-run spend limit (USD, estimated). KLYP_FREE_DAILY_LIMIT_USD overrides it. */
export function freeDailyLimitUsd(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.KLYP_FREE_DAILY_LIMIT_USD);
  return Number.isFinite(n) && n > 0 ? n : 25;
}

export const FREE_CAPACITY_MESSAGE =
  "Free capacity for long videos is full today. Try again tomorrow, or upgrade to Pro to keep going.";

/** Estimated provider cost of analyzing `durationSeconds`, in micro-USD. */
export const estimateRunMicroUsd = (durationSeconds: number): number => Math.round(projectedRunUsd(durationSeconds) * 1_000_000);

export const utcDayStart = (now: number): string => {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
};

const isMissingColumn = (error: { code?: string; message?: string } | null) =>
  !!error && (error.code === "42703" || error.code === "PGRST204" || /plan_at_start|est_cost_micro_usd/.test(error.message ?? ""));

export type CapacityCheck = { ok: true } | { ok: false; status: number; message: string };

/**
 * May this run start? Only Free runs longer than an hour are limited. The migration missing
 * means "no breaker yet"; any other lookup failure refuses the Free long run (fail closed),
 * because that is exactly the abuse the breaker exists to stop.
 */
export async function checkFreeCapacity(opts: {
  plan: PlanName;
  durationSeconds: number;
  now?: number;
  /** The job was already counted when it first started (a retry or resume): never refuse it again. */
  alreadyCounted?: boolean;
  /** Test seam: the day's recorded Free spend in micro-USD, or an error. */
  loadSpend?: (sinceIso: string) => Promise<{ micro: number } | { error: { code?: string; message?: string } }>;
}): Promise<CapacityCheck> {
  if (opts.plan !== "free" || opts.durationSeconds <= FREE_LONG_RUN_SECONDS || opts.alreadyCounted) return { ok: true };
  const now = opts.now ?? Date.now();
  const load = opts.loadSpend ?? loadFreeSpendToday;
  const spent = await load(utcDayStart(now));
  if ("error" in spent) {
    if (isMissingColumn(spent.error)) return { ok: true }; // migration 037 not applied yet
    console.error("[free-capacity] could not read today's Free spend:", spent.error.message);
    return { ok: false, status: 503, message: "Long Free analyses are briefly unavailable. Please try again in a few minutes." };
  }
  const limitMicro = Math.round(freeDailyLimitUsd() * 1_000_000);
  if (spent.micro + estimateRunMicroUsd(opts.durationSeconds) > limitMicro) {
    return { ok: false, status: 429, message: FREE_CAPACITY_MESSAGE };
  }
  return { ok: true };
}

async function loadFreeSpendToday(sinceIso: string): Promise<{ micro: number } | { error: { code?: string; message?: string } }> {
  const { data, error } = await createAdminClient()
    .from("analysis_jobs")
    .select("est_cost_micro_usd")
    .eq("plan_at_start", "free")
    .gte("created_at", sinceIso)
    .limit(20000);
  if (error) return { error };
  return { micro: (data ?? []).reduce((sum, row: { est_cost_micro_usd: number | null }) => sum + (row.est_cost_micro_usd ?? 0), 0) };
}

/**
 * Remember which plan started a job and what it is expected to cost. Best effort: a failure
 * (including the migration not being applied) must never fail the customer's analysis.
 */
export async function recordPlanAtStart(
  save: (changes: Record<string, unknown>) => Promise<unknown>,
  plan: PlanName,
  durationSeconds: number
): Promise<void> {
  try {
    await save({ plan_at_start: plan, est_cost_micro_usd: estimateRunMicroUsd(durationSeconds) });
  } catch (error) {
    console.warn("[free-capacity] could not record the plan for this job:", error instanceof Error ? error.message : error);
  }
}
