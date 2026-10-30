import { estimateProviderCost, type ProviderUsageEvent } from './provider-cost.ts';

export type AnalysisStage = 'chat-scan' | 'audio-scan' | 'scene-scan' | 'download' | 'transcribe' | 'select' | 'visual-check' | 'cache';
export type StageUnits = { bytesDownloaded?: number; bytesWritten?: number; audioSeconds?: number; windows?: number; cacheHit?: boolean };

/** Log measured units per stage. Dollar fields are list-price estimates, never invoices. */
export function createStageMeter(runId: string, write: (line: string) => void = console.log, now: () => number = Date.now) {
  return {
    start(stage: AnalysisStage) {
      const started = now();
      return (units: StageUnits = {}) => {
        write(`[analysis-stage] ${JSON.stringify({ runId, stage, elapsedMs: Math.max(0, now() - started), ...units, estimatedUsd: null })}`);
      };
    },
    provider(stage: AnalysisStage, event: ProviderUsageEvent) {
      if (event.runId !== runId) throw new Error('provider usage belongs to a different VOD run');
      write(`[analysis-stage] ${JSON.stringify({ ...event, stage, estimatedUsd: estimateProviderCost(event) })}`);
    },
  };
}
export type StageMeter = ReturnType<typeof createStageMeter>;

/** Storage units are measured; dollars are illustrative over-quota list price. */
export function archiveUsageEvent(sourceKey: string | null, clipId: string, bytesWritten: number, elapsedMs: number) {
  return { sourceKey, clipId, stage: 'archive', bytesWritten, elapsedMs,
    estimatedStorageUsdFirstMonth: Math.round(bytesWritten / (1024 ** 3) * 0.0213 * 1_000_000) / 1_000_000,
    actualBilledUsd: null };
}
