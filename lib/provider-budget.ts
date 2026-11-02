import { createAdminClient } from '@/lib/supabase/admin';
import { ProviderBudget, STANDARD_RUN_LIMIT_MICRO_USD } from './provider-budget-core';

/**
 * One durable row per job ID also covers restarts and concurrent attempts.
 * `limitMicroUsd` is the run's budget; it is only sent when it is above the standard $3, and the
 * database fixes it at the run's first reservation, so later calls cannot raise it.
 */
export function budgetForRun(runId: string | undefined, limitMicroUsd?: number): ProviderBudget {
  if (!runId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(runId))
    throw new Error('Paid analysis requires a durable job ID');
  const extended = limitMicroUsd !== undefined && limitMicroUsd > STANDARD_RUN_LIMIT_MICRO_USD;
  return new ProviderBudget(async (stage, microUsd) => {
    const { data, error } = await createAdminClient().rpc('reserve_analysis_provider_budget', {
      p_run_id: runId, p_stage: stage, p_upper_bound_micro_usd: microUsd,
      ...(extended ? { p_limit_micro_usd: limitMicroUsd } : {}),
    });
    if (error || typeof data !== 'number')
      throw new Error(`Provider budget reservation failed: ${error?.message ?? 'invalid response'}`);
    console.log(`[provider-budget] ${JSON.stringify({ runId, stage, reservedMicroUsd: microUsd, totalReservedMicroUsd: data })}`);
  });
}
