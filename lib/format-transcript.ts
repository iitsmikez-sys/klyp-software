import type { TimedWord } from './clips';

/**
 * Speech disfluencies that carry no meaning for picking moments: um, uh, er and their stretched forms
 * ("ummm", "uhhh", "erm"). Deliberately NOT "hmm" or "mm" (can be a sarcastic or reacting beat) and
 * never repeated words ("no no no no" is a reaction signal).
 */
const FILLER = /^(?:u+m+|u+h+|e+r+m*)[.,!?…-]*$/i;

/**
 * Transcript text for the clip-picking prompt. With `dropFillers` the filler words above are left out
 * (fewer tokens to read); the word list itself, used for captions and timing, is never changed.
 */
export function formatTranscript(words: TimedWord[], opts: { dropFillers?: boolean } = {}): string {
  if (opts.dropFillers) words = words.filter((w) => !FILLER.test(w.text.trim()));
  const BLOCK_MS = 20_000;
  const lines: string[] = [];
  let blockStart = words.length ? Math.floor(words[0].start / BLOCK_MS) * BLOCK_MS : 0;
  let current: string[] = [];

  const stamp = (ms: number) => {
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h > 0
      ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      : `${m}:${String(s).padStart(2, "0")}`;
  };

  for (const w of words) {
    if (w.start >= blockStart + BLOCK_MS && current.length > 0) {
      lines.push(`[${stamp(blockStart)}] ${current.join(" ")}`);
      current = [];
      blockStart = Math.floor(w.start / BLOCK_MS) * BLOCK_MS;
    }
    current.push(w.text);
  }
  if (current.length > 0) lines.push(`[${stamp(blockStart)}] ${current.join(" ")}`);
  return lines.join("\n");
}
