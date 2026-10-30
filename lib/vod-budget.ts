import type { AudioWindow } from './twitch-chat';

export type BudgetReview = { projectedUsd: number; requiresReview: boolean; audioSeconds: number };

/** Conservative list-price preflight. It pauses the run; it never drops windows. */
export function reviewProcessingBudget(windows: AudioWindow[], ceilingUsd: number): BudgetReview {
  const audioSeconds = windows.reduce((sum, window) => sum + Math.max(0, window.end - window.start), 0);
  const hours = audioSeconds / 3600;
  // AAI best-model rate, Opus input allowance, full 16k output cap, two vision checks,
  // plus an infrastructure allowance. Actual provider units are logged separately.
  const projectedUsd = Math.round((hours * 0.21 + (8000 + 25000 * hours) * 5 / 1_000_000 +
    16000 * 25 / 1_000_000 + 0.05 + 0.25) * 1000) / 1000;
  return { projectedUsd, requiresReview: !Number.isFinite(ceilingUsd) || ceilingUsd <= 0 || projectedUsd > ceilingUsd, audioSeconds };
}
