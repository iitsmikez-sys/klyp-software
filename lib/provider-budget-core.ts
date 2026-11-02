import { AUDIO_USD_PER_HOUR } from './provider-cost.ts';

/** Reservations remain spent after failure: a crashed request might still be billed. */
export class ProviderBudget {
  private reserve: (stage: string, microUsd: number) => Promise<void>;
  constructor(reserve: (stage: string, microUsd: number) => Promise<void>) { this.reserve = reserve; }
  async call<T>(stage: string, microUsd: number, fn: () => Promise<T>): Promise<T> {
    if (!Number.isSafeInteger(microUsd) || microUsd <= 0 || microUsd > 3_000_000)
      throw new Error('Paid call cost cannot be bounded within the $3 provider budget');
    await this.reserve(stage, microUsd);
    return fn();
  }
}

/** The priciest AssemblyAI model Klyp may be billed at (micro-USD per audio hour), from the rate card. */
export const ASSEMBLYAI_MAX_LIST_MICRO_USD_PER_HOUR = Math.round(Math.max(...Object.values(AUDIO_USD_PER_HOUR)) * 1_000_000);

/**
 * How far above the list price a transcription is reserved. AssemblyAI bills pre-recorded
 * audio at a flat per-hour rate, "pro-rated to the exact second of audio processed" and only
 * for the file actually submitted; failed requests aren't charged. Klyp sends audio only
 * (no add-ons, no multichannel — "each channel is transcribed and billed separately" applies
 * only when multichannel is enabled) and lists a cheaper fallback model, so the list price of
 * the best model is the ceiling. 25% over it covers a modest price change. This used to be 2x.
 * Source: assemblyai.com/docs/billing-and-pricing (checked 2026-11-02).
 * KLYP_AAI_RESERVE_FACTOR (1 to 4) overrides it — set 2 to restore the old margin.
 */
export const DEFAULT_TRANSCRIPTION_RESERVE_FACTOR = 1.25;

export function transcriptionReserveFactor(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env.KLYP_AAI_RESERVE_FACTOR);
  return Number.isFinite(raw) && raw >= 1 && raw <= 4 ? raw : DEFAULT_TRANSCRIPTION_RESERVE_FACTOR;
}

/** Upper bound on what transcribing `seconds` of audio can cost, in micro-USD. */
export function quoteTranscription(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 10 * 3600 + 2)
    throw new Error('Transcription duration cannot be bounded');
  return Math.ceil(seconds * ASSEMBLYAI_MAX_LIST_MICRO_USD_PER_HOUR * transcriptionReserveFactor() / 3600);
}

const RATE: Record<string, { input: number; output: number }> = {
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
};
const INPUT_OVERHEAD_TOKENS = 8192;
function quote(model: string, text: string, maxOutputTokens: number, imageTokens = 0): number {
  const rate = RATE[model];
  if (!rate) throw new Error('Provider model has no bounded price');
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens <= 0 || maxOutputTokens > 16_000)
    throw new Error('Output tokens cannot be bounded');
  // UTF-8 bytes overcount text tokens; overhead covers message framing and schema.
  const inputBound = Buffer.byteLength(text, 'utf8') + INPUT_OVERHEAD_TOKENS + imageTokens;
  return Math.ceil(inputBound * rate.input + maxOutputTokens * rate.output);
}

export function quoteTextMessage(model: string, text: string, maxOutputTokens: number): number {
  return quote(model, text, maxOutputTokens);
}

export function quoteVisualMessage(model: string, text: string, maxOutputTokens: number, imageBytes: number): number {
  if (!Number.isSafeInteger(imageBytes) || imageBytes <= 0 || imageBytes > 300_000)
    throw new Error('Image input cannot be bounded');
  return quote(model, text, maxOutputTokens, MAX_IMAGE_TOKENS);
}

/**
 * Hard upper bound on the visual tokens one image can cost. Anthropic downsizes every
 * image to fit the model's limits, so the cost is capped no matter how large the file
 * is: 1,568 tokens on models before Claude 4.7 and 4,784 on 4.7 and later (the
 * "high-resolution" tier). The larger cap is used for every model so a model change
 * can never make this an under-estimate. Our frames are also scaled to <=640px wide
 * (lib/vision-validation.ts), so the real cost is around 1,000 tokens.
 * Source: platform.claude.com/docs/en/build-with-claude/vision, "Resolution and token
 * cost" (checked 2026-11-02). The reservation used to assume 100,000 tokens per image.
 */
export const MAX_IMAGE_TOKENS = 4_784;
