import type { TimedWord } from './clips';

export type TranscriptParagraph = { text: string; start_ms: number; end_ms: number; words: TimedWord[] };

const SENTENCE_END = /[.!?]["')\]]*$/;
/** A block may end at a sentence end once it has this many words. */
const MIN_WORDS_FOR_SENTENCE_BREAK = 10;
const MAX_WORDS = 42;
const MAX_MS = 18000;
/** When a block hits its limit, a sentence end this many words in or later is used as the break instead of cutting mid-sentence. */
const MIN_WORDS_BEFORE_FALLBACK_BREAK = 8;

/**
 * Keep timestamps tied to the original words while presenting a readable transcript. A block ends at the end of a
 * sentence whenever it has enough words, and when a block gets too long it is cut at the last sentence end inside it
 * (only a long run with no sentence end at all is cut in the middle of a sentence).
 */
export function groupTranscriptParagraphs(words: readonly TimedWord[], visible: (word: TimedWord) => boolean = () => true): TranscriptParagraph[] {
  const paragraphs: TranscriptParagraph[] = [];
  let group: TimedWord[] = [];
  const flush = () => {
    if (!group.length) return;
    paragraphs.push({
      text: group.map(word => word.text).join(' '),
      start_ms: group[0].start,
      end_ms: group[group.length - 1].end,
      words: group,
    });
    group = [];
  };

  for (const word of words) {
    if (!visible(word)) { flush(); continue; }
    if (group.length && word.start - group[group.length - 1].end >= 2000) flush();
    group.push(word);
    if (SENTENCE_END.test(word.text) && group.length >= MIN_WORDS_FOR_SENTENCE_BREAK) { flush(); continue; }
    if (group.length >= MAX_WORDS || word.end - group[0].start >= MAX_MS) {
      let cut = -1;
      for (let i = group.length - 2; i >= MIN_WORDS_BEFORE_FALLBACK_BREAK; i--) {
        if (SENTENCE_END.test(group[i].text)) { cut = i; break; }
      }
      if (cut >= 0) {
        const rest = group.splice(cut + 1);
        flush();
        group = rest;
      } else {
        flush();
      }
    }
  }
  flush();
  return paragraphs;
}

export function wordMatchingQuery(paragraph: TranscriptParagraph, query: string): TimedWord | null {
  const match = paragraph.text.toLowerCase().indexOf(query.trim().toLowerCase());
  if (match < 0 || !query.trim()) return null;
  let offset = 0;
  for (const word of paragraph.words) {
    if (match < offset + word.text.length) return word;
    offset += word.text.length + 1;
  }
  return paragraph.words.at(-1) ?? null;
}
