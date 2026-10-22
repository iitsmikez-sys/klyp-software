import type { TimedWord } from "./clips";

/** AssemblyAI timestamps start at zero for the extracted clip. Saved captions
 * and the exporter use absolute timestamps in the original VOD. */
export function offsetRecoveredWords(words: TimedWord[], clipStartSeconds: number, durationSeconds: number): TimedWord[] {
  const offset = Math.round(clipStartSeconds * 1000);
  const limit = Math.round(durationSeconds * 1000) + 500;
  return words.filter((word) =>
    Number.isFinite(word.start) && Number.isFinite(word.end) &&
    word.start >= 0 && word.start < limit && word.end > word.start && word.text.trim().length > 0
  ).map((word) => ({ ...word, start: word.start + offset, end: word.end + offset }));
}

/** Keep model output within the same 3 short, distinct choices offered by new analyses. */
export function cleanRepairHooks(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length !== 3 || value.some((item) => typeof item !== "string")) return null;
  const hooks = value.map((item: string) => item.trim().replace(/[.!?]+$/, "").trim());
  if (hooks.some((hook) => !hook || hook.length > 80 || hook.split(/\s+/).length > 7)) return null;
  if (new Set(hooks.map((hook) => hook.toLocaleLowerCase())).size !== 3) return null;
  return hooks;
}
