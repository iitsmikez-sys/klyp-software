import type { AudioWindow } from './twitch-chat';
import { quoteTextMessage, quoteTranscription, quoteVisualMessage } from './provider-budget-core.ts';

export type BudgetReview = {
  projectedUsd: number;
  requiresReview: boolean;
  audioSeconds: number;
  /** True when one full pass over this audio cannot fit the per-run provider budget. */
  exceedsRunLimit?: boolean;
  /** Longest single full-transcript pass (hours) that does fit the per-run budget. */
  maxRunHours?: number;
};

/**
 * Per-run provider budget enforced at the moment of each paid call (migration
 * 036, reserve_analysis_provider_budget). Kept equal to the SQL limit by
 * tests/run-budget-precheck.test.mjs.
 */
export const RUN_PROVIDER_LIMIT_MICRO_USD = 3_000_000;

// A transcript never holds more than ~12,000 words per audio hour (200 wpm of
// non-stop speech) at ~6.5 bytes a word, plus timestamps — streams are well
// below that. The prompt overhead covers the system prompt, schema and the
// prior-clips / preference sections.
const TRANSCRIPT_BYTES_PER_HOUR_BOUND = 70_000;
const PROMPT_OVERHEAD_BYTES = 30_000;
const SELECT_MODEL = 'claude-opus-4-8';
const SELECT_MAX_OUTPUT_TOKENS = 16_000;
/** planVisualChecks() inspects the two strongest moments. */
const VISUAL_CHECKS = 2;
const VISUAL_PROMPT_BYTES = 700;
const VISUAL_MAX_OUTPUT_TOKENS = 100;
const VISUAL_MAX_IMAGE_BYTES = 300_000;
const visionModel = () => process.env.KLYP_VISION_MODEL || 'claude-sonnet-4-6';

/** KLYP_RUN_BUDGET_PRECHECK=off restores the old behavior (no early run-budget check). */
const runBudgetPrecheckEnabled = () => !/^(0|off|false)$/i.test(process.env.KLYP_RUN_BUDGET_PRECHECK ?? '');

/**
 * Upper bound, in micro-USD, that the provider-budget gate will reserve across
 * the three paid stages of ONE full-transcript pass over `audioSeconds`: the
 * transcription, the Opus clip selection, and the two finalist visual checks.
 * Built from the same quote functions the gate itself uses, so the two cannot
 * drift. Null when the audio cannot be priced at all.
 */
export function reservedMicroUsdForPass(audioSeconds: number): number | null {
  if (!Number.isFinite(audioSeconds) || audioSeconds <= 0) return 0;
  try {
    const transcript = quoteTranscription(audioSeconds);
    const transcriptBytes = PROMPT_OVERHEAD_BYTES + Math.ceil((audioSeconds / 3600) * TRANSCRIPT_BYTES_PER_HOUR_BOUND);
    const select = quoteTextMessage(SELECT_MODEL, 'x'.repeat(transcriptBytes), SELECT_MAX_OUTPUT_TOKENS);
    const visual = VISUAL_CHECKS *
      quoteVisualMessage(visionModel(), 'x'.repeat(VISUAL_PROMPT_BYTES), VISUAL_MAX_OUTPUT_TOKENS, VISUAL_MAX_IMAGE_BYTES);
    return transcript + select + visual;
  } catch {
    return null;
  }
}

/** The longest full-transcript pass (in seconds) that fits the per-run budget. */
export function maxFullPassSeconds(): number {
  let lo = 0;
  let hi = 10 * 3600;
  while (hi - lo > 30) {
    const mid = Math.floor((lo + hi) / 2);
    const reserved = reservedMicroUsdForPass(mid);
    if (reserved !== null && reserved <= RUN_PROVIDER_LIMIT_MICRO_USD) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Conservative list-price preflight. It pauses the run; it never drops windows. */
export function reviewProcessingBudget(windows: AudioWindow[], ceilingUsd: number): BudgetReview {
  const audioSeconds = windows.reduce((sum, window) => sum + Math.max(0, window.end - window.start), 0);
  const hours = audioSeconds / 3600;
  // AAI best-model rate, Opus input allowance, full 16k output cap, two vision checks,
  // plus an infrastructure allowance. Actual provider units are logged separately.
  const projectedUsd = Math.round((hours * 0.21 + (8000 + 25000 * hours) * 5 / 1_000_000 +
    16000 * 25 / 1_000_000 + 0.05 + 0.25) * 1000) / 1000;

  // The real gate reserves cumulatively per run and only fails AFTER the paid
  // transcription (and sometimes the Opus call) has already been spent. Refuse
  // the run now, before anything is downloaded or paid for, when it cannot finish.
  const reserved = reservedMicroUsdForPass(audioSeconds);
  const exceedsRunLimit = reserved === null || reserved > RUN_PROVIDER_LIMIT_MICRO_USD;

  return {
    projectedUsd,
    requiresReview: !Number.isFinite(ceilingUsd) || ceilingUsd <= 0 || projectedUsd > ceilingUsd ||
      (exceedsRunLimit && runBudgetPrecheckEnabled()),
    audioSeconds,
    exceedsRunLimit,
    maxRunHours: exceedsRunLimit ? Math.round((maxFullPassSeconds() / 3600) * 10) / 10 : undefined,
  };
}
