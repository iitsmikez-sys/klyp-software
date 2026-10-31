import type { TimedWord } from './clips';

export type TranscriptParagraph = { text: string; start_ms: number; end_ms: number; words: TimedWord[] };

/** Keep timestamps tied to the original words while presenting a readable transcript. */
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
    const sentenceEnd = /[.!?]["')\]]*$/.test(word.text);
    if ((sentenceEnd && group.length >= 18) || group.length >= 42 || word.end - group[0].start >= 18000) flush();
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
