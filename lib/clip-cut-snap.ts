/**
 * Tighter cuts. The AI reads a transcript with a time stamp only every 20 seconds, so the start and end it
 * proposes are rough and often include a rambling lead-in or talk after the punchline. It also quotes the first
 * and last words of the moment it wants. This snaps the cut to those exact words, using the saved word timings.
 *
 * Safe by design: if a quote cannot be found close to the proposed cut, that side is left alone, and a trim is
 * never allowed to leave a clip shorter than 16 seconds or longer than 60.
 */
import type { TimedWord } from "./clips.ts";

/** The boundary review drops any clip under 15 seconds, so a trim must never go below that (a little margin for rounding). */
export const MIN_TRIMMED_SECONDS = 16;
export const MAX_SECONDS = 60;
/** How far before the proposed start, and after the proposed end, a quote may be found. */
const SEARCH_BEFORE_START_S = 15;
const SEARCH_AFTER_END_S = 10;
/** Breathing room kept before the first word and after the last word. */
const LEAD_IN_S = 0.3;
const TAIL_S = 0.5;

type Windowed = { start_seconds: number; end_seconds: number; thumbnail_seconds: number; start_quote?: string; end_quote?: string };

const norm = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const quoteTokens = (quote: string | undefined) => (quote ?? "").split(/\s+/).map(norm).filter(Boolean);

/** Index of the first word of `tokens` found in `words` (consecutive), with start inside [fromMs, toMs]; nearest to `nearMs`. */
function findRun(words: { token: string; start: number }[], tokens: string[], fromMs: number, toMs: number, nearMs: number): number {
  let best = -1;
  for (let i = 0; i <= words.length - tokens.length; i++) {
    if (words[i].start < fromMs || words[i].start > toMs) continue;
    if (tokens.every((t, j) => words[i + j].token === t) && (best < 0 || Math.abs(words[i].start - nearMs) < Math.abs(words[best].start - nearMs))) best = i;
  }
  return best;
}

export function trimClip<T extends Windowed>(clip: T, words: readonly TimedWord[]): T {
  const startMs = clip.start_seconds * 1000;
  const endMs = clip.end_seconds * 1000;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return clip;

  const tokenized = words.map((w) => ({ token: norm(w.text), start: w.start, end: w.end })).filter((w) => w.token);
  const startTokens = quoteTokens(clip.start_quote).slice(0, 5);
  const endTokens = quoteTokens(clip.end_quote).slice(-5);
  if (startTokens.length < 2 && endTokens.length < 2) return clip;

  let newStartMs = startMs;
  let newEndMs = endMs;

  if (startTokens.length >= 2) {
    const at = findRun(tokenized, startTokens, startMs - SEARCH_BEFORE_START_S * 1000, endMs - MIN_TRIMMED_SECONDS * 1000, startMs);
    if (at >= 0) newStartMs = Math.max(0, tokenized[at].start - LEAD_IN_S * 1000);
  }
  if (endTokens.length >= 2) {
    const at = findRun(tokenized, endTokens, newStartMs + (MIN_TRIMMED_SECONDS - 4) * 1000, endMs + SEARCH_AFTER_END_S * 1000, endMs);
    if (at >= 0) newEndMs = tokenized[at + endTokens.length - 1].end + TAIL_S * 1000;
  }

  const seconds = (newEndMs - newStartMs) / 1000;
  if (seconds < MIN_TRIMMED_SECONDS || seconds > MAX_SECONDS) return clip;
  if (newStartMs === startMs && newEndMs === endMs) return clip;

  // The AI sometimes gives the thumbnail time from the clip start and sometimes from the VOD start: make it absolute.
  let thumbnail = clip.thumbnail_seconds;
  if (Number.isFinite(thumbnail) && thumbnail < clip.start_seconds) thumbnail = clip.start_seconds + thumbnail;
  const start = Math.round(newStartMs) / 1000;
  const end = Math.round(newEndMs) / 1000;
  if (!Number.isFinite(thumbnail) || thumbnail < start || thumbnail >= end) thumbnail = (start + end) / 2;
  return { ...clip, start_seconds: start, end_seconds: end, thumbnail_seconds: thumbnail };
}

export function trimClipBatch<T extends Windowed>(clips: readonly T[], words: readonly TimedWord[]): T[] {
  return clips.map((clip) => trimClip(clip, words));
}
