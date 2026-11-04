/**
 * Klyp's prompt is in English, so without a hint Claude may write clip titles and hooks in English over a
 * Spanish or Portuguese stream. Transcription already follows the spoken language; this checks whether the
 * transcript is mostly English and, when it is not, tells Claude to write in the streamer's language.
 */
import type { TimedWord } from "./clips";

/** Common English words that are not also common in Spanish, Portuguese, French, Italian or German. */
const ENGLISH_MARKERS = new Set(["the", "and", "you", "is", "it", "that", "this", "they", "with", "are", "was", "have", "what", "just", "but", "for", "not", "we", "he", "of", "to", "in", "on", "i", "my", "your", "like", "so", "do", "be"]);
/** Share of words that must be English markers for the stream to count as English. */
const ENGLISH_SHARE = 0.18;
const SAMPLE_WORDS = 3000;
const MIN_WORDS = 60;

/** True for English streams and for transcripts too short to judge, so English users never see a change. */
export function isMostlyEnglish(words: Pick<TimedWord, "text">[]): boolean {
  if (words.length < MIN_WORDS) return true;
  const sample = words.slice(0, SAMPLE_WORDS);
  let hits = 0;
  for (const w of sample) if (ENGLISH_MARKERS.has(w.text.toLowerCase().replace(/[^a-z']/g, ""))) hits++;
  return hits / sample.length >= ENGLISH_SHARE;
}

/** The prompt section for a stream that is not in English. */
export function languageSection(): string {
  return `

## LANGUAGE

The streamer in this VOD may not speak English. Write every clip title and every hook in the language the streamer actually speaks in the transcript, naturally, the way a native-speaking short-form editor would. Do not default to English and do not translate into English. Keep the field names, clip type labels and numbers exactly as the schema requires.`;
}
