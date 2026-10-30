import type { TimedWord } from './clips';

export function formatTranscript(words: TimedWord[]): string {
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
