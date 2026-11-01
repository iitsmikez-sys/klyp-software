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

/** Best-quality AssemblyAI async model is $0.21/hour; reserve twice that rate. */
export function quoteTranscription(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 10 * 3600 + 2)
    throw new Error('Transcription duration cannot be bounded');
  return Math.ceil(seconds * 420_000 / 3600);
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
  // Anthropic downsizes images; 100k tokens is far above a single accepted frame.
  return quote(model, text, maxOutputTokens, 100_000);
}
