/** Measured provider units for one VOD analysis. No source URL or user data is logged. */
export type ProviderUsageEvent =
  | { runId: string; stage?: string; provider: "assemblyai"; model: string | null; audioSeconds: number }
  | { runId: string; stage?: string; provider: "anthropic"; model: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };

/** Public list prices checked 2026-10-28. Raw units are retained if prices change. */
const AUDIO_USD_PER_HOUR: Record<string, number> = {
  "universal-3-5-pro": 0.21,
  "universal-2": 0.15,
};
const TOKENS_USD_PER_MILLION: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
};

/** Rate-card estimate; the raw units remain in the log for later reconciliation. */
export function estimateProviderCost(event: ProviderUsageEvent): number | null {
  if (event.provider === "assemblyai") {
    const rate = event.model ? AUDIO_USD_PER_HOUR[event.model] : undefined;
    return rate === undefined ? null : Math.round(event.audioSeconds / 3600 * rate * 1_000_000) / 1_000_000;
  }
  const rate = TOKENS_USD_PER_MILLION[event.model];
  if (!rate) return null;
  const usd = (event.inputTokens * rate.input + event.outputTokens * rate.output +
    event.cacheReadTokens * rate.cacheRead + event.cacheWriteTokens * rate.cacheWrite) / 1_000_000;
  return Math.round(usd * 1_000_000) / 1_000_000;
}

export function recordProviderUsage(event: ProviderUsageEvent, write: (line: string) => void = console.log): void {
  write(`[provider-usage] ${JSON.stringify({ ...event, estimatedUsd: estimateProviderCost(event) })}`);
}
