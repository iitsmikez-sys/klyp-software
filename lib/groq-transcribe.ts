/**
 * Transcription with Groq's Whisper (about $0.04 an hour, against $0.21 for the current service).
 *
 * Three things make it safe to use for real VODs:
 *  - Long audio is cut into 20 minute chunks (Groq takes files up to about 25 MB), each overlapping its
 *    neighbours by a few seconds so no word is cut in half, and the words are stitched back into one timeline.
 *  - Whisper sometimes invents text in silence (for example "Legenda Adriana Zanotto" over and over). Segments that
 *    look like that are removed before anything else sees them.
 *  - Rate limits and short outages are retried; the caller falls back to the old service if Groq still fails.
 *
 * No imports on purpose, so the rules can be tested on their own.
 */
export const GROQ_MODEL = "whisper-large-v3-turbo";
export const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
export const CHUNK_SECONDS = 20 * 60;
export const OVERLAP_SECONDS = 3;
const MAX_ATTEMPTS = 4;
const PARALLEL_CHUNKS = 2;

export type TimedWordLike = { text: string; start: number; end: number };
export type GroqWord = { word: string; start: number; end: number };
export type GroqSegment = { start: number; end: number; text?: string; no_speech_prob?: number; avg_logprob?: number; compression_ratio?: number };
export type GroqResult = { words?: GroqWord[]; segments?: GroqSegment[]; language?: string };

/** Subtitle credits and sign-offs Whisper tends to make up over silence or music. */
const MADE_UP_TEXT = /^\W*(legendas?\b|tradu[cç][aã]o\b|subtitles? (by|from)\b|subt[ií]tulos?\b|amara\.org|thanks? for watching|thank you for watching|obrigad[oa] por assistir|gracias por ver|please subscribe|like and subscribe)/i;

/** True for a segment that is probably not real speech. */
export function isMadeUpSegment(segment: GroqSegment): boolean {
  if (segment.text && MADE_UP_TEXT.test(segment.text.trim())) return true;
  if ((segment.no_speech_prob ?? 0) > 0.6 && (segment.avg_logprob ?? 0) < -1) return true;
  if ((segment.compression_ratio ?? 0) > 2.4) return true;
  return false;
}

/** Words in milliseconds on the chunk's own clock, without the words that sit inside made-up segments. */
export function cleanChunkWords(result: GroqResult): TimedWordLike[] {
  const bad = (result.segments ?? []).filter(isMadeUpSegment);
  const out: TimedWordLike[] = [];
  for (const word of result.words ?? []) {
    const text = (word.word ?? "").trim();
    if (!text || !Number.isFinite(word.start) || !Number.isFinite(word.end)) continue;
    const middle = (word.start + word.end) / 2;
    if (bad.some((segment) => middle >= segment.start - 0.01 && middle <= segment.end + 0.01)) continue;
    out.push({ text, start: Math.round(word.start * 1000), end: Math.round(Math.max(word.end, word.start) * 1000) });
  }
  return out;
}

export type ChunkPlan = { index: number; start: number; length: number; keepFrom: number; keepUntil: number };

/** Where to cut a recording of `durationSeconds`. Each chunk reaches a little past the part it is responsible for. */
export function planChunks(durationSeconds: number, chunkSeconds = CHUNK_SECONDS, overlapSeconds = OVERLAP_SECONDS): ChunkPlan[] {
  if (!(durationSeconds > 0)) return [];
  const plans: ChunkPlan[] = [];
  const count = Math.max(1, Math.ceil(durationSeconds / chunkSeconds));
  for (let index = 0; index < count; index++) {
    const keepFrom = index * chunkSeconds;
    const last = index === count - 1;
    const keepUntil = last ? Infinity : (index + 1) * chunkSeconds;
    const start = Math.max(0, keepFrom - (index === 0 ? 0 : overlapSeconds));
    const end = Math.min(durationSeconds, (last ? durationSeconds : keepUntil) + (last ? 0 : overlapSeconds));
    plans.push({ index, start, length: Math.max(0.5, end - start), keepFrom, keepUntil });
  }
  return plans;
}

/** Puts every chunk's words on the recording's clock and keeps each word from only the chunk that owns that moment. */
export function stitchChunks(chunks: { plan: ChunkPlan; words: TimedWordLike[] }[]): TimedWordLike[] {
  const all: TimedWordLike[] = [];
  for (const { plan, words } of chunks) {
    for (const word of words) {
      const start = word.start + Math.round(plan.start * 1000), end = word.end + Math.round(plan.start * 1000);
      const middle = (start + end) / 2;
      if (middle >= plan.keepFrom * 1000 && middle < plan.keepUntil * 1000) all.push({ text: word.text, start, end });
    }
  }
  return all.sort((a, b) => a.start - b.start);
}

export type GroqDeps = {
  apiKey: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Writes `length` seconds of the recording starting at `start` to `target` as a small mono mp3. */
  makeChunk: (start: number, length: number, target: string) => Promise<void>;
  readFile: (path: string) => Promise<Uint8Array>;
  removeFile?: (path: string) => Promise<void>;
  tempPath: (name: string) => string;
};

async function requestChunk(bytes: Uint8Array, name: string, deps: GroqDeps): Promise<GroqResult> {
  const doFetch = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let lastStatus = 0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const form = new FormData();
    form.append("file", new Blob([bytes as BlobPart], { type: "audio/mpeg" }), name);
    form.append("model", GROQ_MODEL);
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");
    form.append("timestamp_granularities[]", "segment");
    form.append("temperature", "0");
    let response: Response;
    try {
      response = await doFetch(GROQ_URL, { method: "POST", headers: { Authorization: `Bearer ${deps.apiKey}` }, body: form, signal: AbortSignal.timeout(180_000) });
    } catch (error) {
      lastStatus = 0;
      if (attempt === MAX_ATTEMPTS) throw new Error(`Groq transcription could not be reached: ${error instanceof Error ? error.message : "network error"}`);
      await sleep(Math.min(30_000, 1500 * 2 ** (attempt - 1)));
      continue;
    }
    if (response.ok) return (await response.json()) as GroqResult;
    lastStatus = response.status;
    if ((response.status === 429 || response.status >= 500) && attempt < MAX_ATTEMPTS) {
      const asked = Number(response.headers.get("retry-after"));
      await sleep(Math.min(30_000, Number.isFinite(asked) && asked > 0 ? asked * 1000 : 1500 * 2 ** (attempt - 1)));
      continue;
    }
    break;
  }
  throw new Error(`Groq transcription failed (HTTP ${lastStatus})`);
}

/** Transcribe a whole recording. Returns words in milliseconds on the recording's own clock. */
export async function groqTranscribe(durationSeconds: number, deps: GroqDeps): Promise<{ words: TimedWordLike[]; language: string | null }> {
  const plans = planChunks(durationSeconds);
  const done: { plan: ChunkPlan; words: TimedWordLike[]; language: string | null }[] = [];
  for (let offset = 0; offset < plans.length; offset += PARALLEL_CHUNKS) {
    const batch = plans.slice(offset, offset + PARALLEL_CHUNKS);
    done.push(...await Promise.all(batch.map(async (plan) => {
      const file = deps.tempPath(`groq-chunk-${plan.index}.mp3`);
      try {
        await deps.makeChunk(plan.start, plan.length, file);
        const result = await requestChunk(await deps.readFile(file), `chunk-${plan.index}.mp3`, deps);
        return { plan, words: cleanChunkWords(result), language: result.language ?? null };
      } finally {
        await deps.removeFile?.(file).catch(() => {});
      }
    })));
  }
  const language = done.find((chunk) => chunk.language)?.language ?? null;
  return { words: stitchChunks(done), language };
}
