import type { TimedWord } from './clips';

export type BoundaryFlag =
  | 'invalid_window' | 'duration_under_15s' | 'duration_over_60s'
  | 'thumbnail_needs_review' | 'opening_silence' | 'possible_missing_context'
  | 'ends_mid_sentence' | 'possible_payoff_after_end';

type WindowedClip = {
  start_seconds: number;
  end_seconds: number;
  thumbnail_seconds: number;
  title: string;
  reason: string;
};
export type FlaggedClip<T> = { clip: T; flags: BoundaryFlag[] };
export type BoundaryReview<T> = { ready: T[]; flagged: FlaggedClip<T>[] };
const terminal = /[.!?]["')\]]*$/;
const meaningful = /\b(answer|reply|respond|response|payoff|reaction|claim)\b/i;
const stopWords = new Set(['about', 'after', 'again', 'actually', 'before', 'chat', 'clip', 'could', 'every',
  'funny', 'moment', 'their', 'there', 'these', 'those', 'would', 'where', 'which', 'while', 'with']);

function token(text: string): string { return text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''); }
function seconds(ms: number): number { return Math.round(ms) / 1000; }

/** Returns the end of a complete nearby utterance; a long or unknown continuation is not guessed. */
function utteranceEnd(words: TimedWord[], from: number, maxEndMs: number): number | null {
  for (let i = from; i < words.length && words[i].start <= maxEndMs; i++) {
    if (i > from && words[i].start - words[i - 1].end > 2500) return null;
    if (terminal.test(words[i].text.trim())) {
      // Keep a small tail only when it does not enter the next spoken line.
      const nextStart = words[i + 1]?.start;
      return nextStart === undefined ? words[i].end + 300
        : Math.max(words[i].end, Math.min(words[i].end + 300, nextStart - 10));
    }
  }
  return null;
}

function quoteEndAfter(words: TimedWord[], reason: string, oldEndMs: number): number | null {
  const quoted = [...reason.matchAll(/['"]([^'"]{5,80})['"]/g)];
  let latest: number | null = null;
  for (const match of quoted) {
    const phrase = match[1].split(/\s+/).map(token).filter(Boolean);
    if (phrase.length < 2 && (phrase[0]?.length ?? 0) < 8) continue;
    for (let i = 0; i <= words.length - phrase.length; i++) {
      if (words[i].start < oldEndMs || words[i].start > oldEndMs + 30000) continue;
      if (phrase.every((part, j) => token(words[i + j].text) === part)) {
        const end = utteranceEnd(words, i + phrase.length - 1, oldEndMs + 32000);
        if (end !== null) latest = Math.max(latest ?? 0, end);
      }
    }
  }
  return latest;
}

/** A title/topic word already spoken is evidence that trimming past it may lose the setup. */
function firstTopicWord(words: TimedWord[], title: string, startMs: number, endMs: number): number | null {
  const terms = new Set(title.split(/\s+/).map(token).filter(part => part.length >= 5 && !stopWords.has(part)));
  const found = words.find(word => word.start >= startMs && word.start < endMs && terms.has(token(word.text)));
  return found?.start ?? null;
}

/** Review and conservatively repair cuts using only saved word timings. Never trim a payoff to meet 60s. */
export function reviewClipBatch<T extends WindowedClip>(
  clips: readonly T[], words: readonly TimedWord[], vodSeconds: number,
): BoundaryReview<T> {
  const ready: T[] = [];
  const flagged: FlaggedClip<T>[] = [];
  const ordered = [...words].filter(w => Number.isFinite(w.start) && Number.isFinite(w.end) && w.end >= w.start)
    .sort((a, b) => a.start - b.start);

  for (const source of clips) {
    const flags: BoundaryFlag[] = [];
    const originalStart = source.start_seconds;
    const originalEnd = source.end_seconds;
    if (!Number.isFinite(originalStart) || !Number.isFinite(originalEnd) || !Number.isFinite(vodSeconds) ||
        originalStart < 0 || originalEnd <= originalStart || originalEnd > vodSeconds) {
      flagged.push({ clip: { ...source }, flags: ['invalid_window'] });
      continue;
    }
    let startMs = originalStart * 1000;
    let endMs = originalEnd * 1000;
    const lastIndex = ordered.findLastIndex(w => w.start < endMs && w.end >= startMs);
    const last = ordered[lastIndex];
    const next = ordered[lastIndex + 1];
    let completion: number | null = null;

    // A cut through a word or sentence is extended to the next nearby sentence end.
    if (last && (last.end > endMs ||
        (next && next.start - endMs <= 1500 && last.end >= endMs - 2000 && !terminal.test(last.text.trim())))) {
      completion = utteranceEnd(ordered, lastIndex, endMs + 8000);
      if (completion === null) flags.push('ends_mid_sentence');
    }
    const quotedEnd = quoteEndAfter(ordered, source.reason, endMs);
    if (quotedEnd !== null) completion = Math.max(completion ?? 0, quotedEnd);

    const inside = ordered.filter(w => w.start >= startMs && w.start < endMs);
    const lastQuestion = [...inside].reverse().find(w => /\?\s*$/.test(w.text));
    if (quotedEnd === null && lastQuestion && next && next.start - endMs <= 8000 &&
        endMs - lastQuestion.end <= 12000 && meaningful.test(source.reason) &&
        !inside.some(w => w.start > lastQuestion.end && terminal.test(w.text.trim()))) {
      const answerIndex = ordered.findIndex(w => w.start >= endMs && w.start <= endMs + 8000 &&
        /^(i|yeah|yes|no|because|um)$/i.test(token(w.text)));
      const answerEnd = answerIndex < 0 ? null : utteranceEnd(ordered, answerIndex, endMs + 12000);
      if (answerEnd !== null) completion = Math.max(completion ?? 0, answerEnd);
      else flags.push('possible_payoff_after_end');
    }
    // A nearby claim or audible reaction after the current sentence belongs to the same beat.
    const completedAt = Math.max(endMs, completion ?? 0);
    const followIndex = ordered.findIndex(w => w.start >= completedAt && w.start <= endMs + 7000);
    const follow = ordered[followIndex];
    if (follow && follow.start - completedAt <= 2500 && meaningful.test(source.reason) &&
        (/\bclaim\b/i.test(source.reason) || /^(oh|wow|whoa|haha|no)$/i.test(token(follow.text)))) {
      const followEnd = utteranceEnd(ordered, followIndex, endMs + 9000);
      if (followEnd !== null) completion = Math.max(completion ?? 0, followEnd);
    }
    // An explicit evaluative line about the clip topic is likely a payoff, not trailing filler.
    const topic = new Set(source.title.split(/\s+/).map(token).filter(part => part.length >= 5 && !stopWords.has(part)));
    const evaluationIndex = ordered.findIndex((w, i) => w.start > endMs && w.start <= endMs + 8000 &&
      /^(best|worst|amazing|insane)$/i.test(token(w.text)) &&
      ordered.slice(i, i + 8).some(later => topic.has(token(later.text))));
    if (evaluationIndex >= 0) {
      const evaluationEnd = utteranceEnd(ordered, evaluationIndex, endMs + 12000);
      if (evaluationEnd !== null) completion = Math.max(completion ?? 0, evaluationEnd);
    }
    if (completion !== null && completion > endMs) endMs = completion;
    // An added payoff can itself overlap the next sentence; finish that sentence too.
    const adjustedLastIndex = ordered.findLastIndex(w => w.start < endMs && w.end >= startMs);
    const adjustedLast = ordered[adjustedLastIndex];
    const adjustedNext = ordered[adjustedLastIndex + 1];
    if (completion !== null && adjustedLast && adjustedNext &&
        !terminal.test(adjustedLast.text.trim()) && adjustedNext.start - endMs <= 1500) {
      const continuation = utteranceEnd(ordered, adjustedLastIndex, endMs + 5000);
      if (continuation !== null) endMs = Math.max(endMs, continuation);
    }

    if (endMs - startMs > 60000) {
      const earliestTopic = firstTopicWord(ordered, source.title, startMs, endMs);
      const minimum = endMs - 60000;
      const candidate = ordered.find((w, i) => w.start >= minimum && w.start <= startMs + 25000 &&
        (i === 0 || terminal.test(ordered[i - 1].text.trim()) || w.start - ordered[i - 1].end >= 2500));
      if (candidate && (earliestTopic === null || candidate.start <= earliestTopic)) startMs = Math.max(minimum, candidate.start - 250);
      if (endMs - startMs > 60000) flags.push('duration_over_60s');
    }
    if (endMs / 1000 > vodSeconds) flags.push('invalid_window');
    if (endMs - startMs < 15000) flags.push('duration_under_15s');

    const first = ordered.find(w => w.start >= startMs && w.start < endMs);
    const previous = ordered.findLast(w => w.start < startMs);
    if (first && first.start - startMs >= 6000) flags.push('opening_silence');
    if (first && previous && first.start - startMs <= 1500 &&
        previous.end >= startMs - 1000 && !terminal.test(previous.text.trim())) flags.push('possible_missing_context');
    const finalWord = ordered.findLast(w => w.start >= startMs && w.start < endMs);
    const after = ordered.find(w => w.start >= endMs);
    if (finalWord && (finalWord.end > endMs ||
        (after && after.start - endMs <= 1500 && finalWord.end >= endMs - 2000 &&
          !terminal.test(finalWord.text.trim())))) flags.push('ends_mid_sentence');

    let thumbnail = source.thumbnail_seconds;
    if (!Number.isFinite(thumbnail) || thumbnail < originalStart || thumbnail >= originalEnd) {
      if (Number.isFinite(thumbnail) && thumbnail >= 0 && thumbnail < originalEnd - originalStart) {
        thumbnail = originalStart + thumbnail;
      } else {
        thumbnail = (startMs + endMs) / 2000;
        flags.push('thumbnail_needs_review');
      }
    }
    if (thumbnail < startMs / 1000 || thumbnail >= endMs / 1000) {
      thumbnail = (startMs + endMs) / 2000;
      flags.push('thumbnail_needs_review');
    }
    const clip = { ...source, start_seconds: seconds(startMs), end_seconds: seconds(endMs),
      thumbnail_seconds: thumbnail } as T;
    if (flags.length) flagged.push({ clip, flags: [...new Set(flags)] });
    else ready.push(clip);
  }
  return { ready, flagged };
}
