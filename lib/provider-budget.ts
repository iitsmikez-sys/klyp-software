import { createAdminClient } from '@/lib/supabase/admin';
import { ProviderBudget } from './provider-budget-core';

/** One durable row per job ID also covers restarts and concurrent attempts. */
export function budgetForRun(runId: string | undefined): ProviderBudget {
  if (!runId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(runId))
    throw new Error('Paid analysis requires a durable job ID');
  return new ProviderBudget(async (stage, microUsd) => {
    const { data, error } = await createAdminClient().rpc('reserve_analysis_provider_budget', {
      p_run_id: runId, p_stage: stage, p_upper_bound_micro_usd: microUsd,
    });
    if (error || typeof data !== 'number')
      throw new Error(`Provider budget reservation failed: ${error?.message ?? 'invalid response'}`);
    console.log(`[provider-budget] ${JSON.stringify({ runId, stage, reservedMicroUsd: microUsd, totalReservedMicroUsd: data })}`);
  });
}
