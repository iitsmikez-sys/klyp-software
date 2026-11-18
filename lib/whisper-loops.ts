/**
 * Whisper sometimes gets stuck and writes the same word or phrase over and over ("Run. Run. Run." 119 times in a row),
 * usually over noise or music. A loop like that can bury the best moment of a stream, so it is found here and the stretch
 * is re-transcribed by another service. Pure functions, no imports, so the rules can be tested on their own.
 */
export type LoopWord = { text: string; start: number; end: number };
export type WordLoop = { fromIndex: number; toIndex: number; period: number; startMs: number; endMs: number };
export type MsWindow = { startMs: number; endMs: number };

/** A stretch is a loop when this many words in a row repeat the words just before them. Real speech ("no no no no") stays well below it. */
export const LOOP_MIN_MATCHES = 8;
const MAX_PERIOD = 4;

const norm = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");

/** Every loop of a repeating word or short phrase (up to 4 words long), merged where they overlap. */
export function findWordLoops(words: LoopWord[], minMatches = LOOP_MIN_MATCHES): WordLoop[] {
  const keys = words.map((w) => norm(w.text));
  const found: WordLoop[] = [];
  for (let period = 1; period <= MAX_PERIOD; period++) {
    let i = 0;
    while (i + period < keys.length) {
      let j = i;
      while (j + period < keys.length && keys[j] !== "" && keys[j] === keys[j + period]) j++;
      const matches = j - i;
      if (matches >= minMatches) {
        const toIndex = j + period - 1;
        found.push({ fromIndex: i, toIndex, period, startMs: words[i].start, endMs: words[toIndex].end });
        i = j + 1;
      } else {
        i = Math.max(i + 1, j);
      }
    }
  }
  found.sort((a, b) => a.fromIndex - b.fromIndex);
  const merged: WordLoop[] = [];
  for (const loop of found) {
    const last = merged[merged.length - 1];
    if (last && loop.fromIndex <= last.toIndex + 1) {
      if (loop.toIndex > last.toIndex) { last.toIndex = loop.toIndex; last.endMs = loop.endMs; }
      last.period = Math.min(last.period, loop.period);
    } else merged.push({ ...loop });
  }
  return merged;
}

/** The stretches to send to another service: each loop with some room on both sides, close ones joined, kept inside the recording. */
export function repairWindowsFor(loops: WordLoop[], padMs = 10_000, totalMs = Infinity): MsWindow[] {
  const windows: MsWindow[] = [];
  for (const loop of loops) {
    const startMs = Math.max(0, loop.startMs - padMs);
    const endMs = Math.min(totalMs, loop.endMs + padMs);
    const last = windows[windows.length - 1];
    if (last && startMs <= last.endMs) last.endMs = Math.max(last.endMs, endMs);
    else windows.push({ startMs, endMs });
  }
  return windows;
}

/** Replaces the words that start inside a window with a repaired version of that stretch. */
export function spliceRepaired(words: LoopWord[], window: MsWindow, replacement: LoopWord[]): LoopWord[] {
  const before = words.filter((w) => w.start < window.startMs);
  const after = words.filter((w) => w.start >= window.endMs);
  const inside = replacement.filter((w) => w.start >= window.startMs && w.start < window.endMs);
  return [...before, ...inside, ...after];
}

/** Last resort when a loop could not be repaired: keep the first three repeats of it and drop the rest. */
export function collapseLoops(words: LoopWord[], minMatches = LOOP_MIN_MATCHES): LoopWord[] {
  const loops = findWordLoops(words, minMatches);
  if (!loops.length) return words;
  const drop = new Set<number>();
  for (const loop of loops) for (let i = loop.fromIndex + loop.period * 3; i <= loop.toIndex; i++) drop.add(i);
  return words.filter((_, index) => !drop.has(index));
}
