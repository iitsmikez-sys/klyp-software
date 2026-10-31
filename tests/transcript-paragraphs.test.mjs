import test from 'node:test';
import assert from 'node:assert/strict';
import { groupTranscriptParagraphs, wordMatchingQuery } from '../lib/transcript-paragraphs.ts';

test('groups timed words into readable paragraphs with exact seek ranges', () => {
  const words = Array.from({ length: 65 }, (_, index) => ({
    text: index === 24 ? 'payoff.' : `word${index}`,
    start: 100000 + index * 400,
    end: 100300 + index * 400,
  }));
  const paragraphs = groupTranscriptParagraphs(words);
  assert.ok(paragraphs.length > 1 && paragraphs.length < 8);
  assert.equal(paragraphs[0].start_ms, words[0].start);
  assert.equal(paragraphs.at(-1).end_ms, words.at(-1).end);
  assert.deepEqual(paragraphs.flatMap(p => p.text.split(' ')), words.map(w => w.text));
  assert.ok(paragraphs[0].text.endsWith('payoff.'), 'prefer a sentence break after enough words');
});

test('a long silence starts a new paragraph', () => {
  const words = Array.from({ length: 14 }, (_, index) => ({
    text: `word${index}`,
    start: index < 7 ? index * 400 : 9000 + (index - 7) * 400,
    end: index < 7 ? index * 400 + 300 : 9300 + (index - 7) * 400,
  }));
  const paragraphs = groupTranscriptParagraphs(words);
  assert.equal(paragraphs.length, 2);
  assert.equal(paragraphs[1].start_ms, 9000);
});

test('deleted words are absent from displayed and searched paragraphs', () => {
  const words = ['keep', 'deleted', 'payoff'].map((text, index) => ({ text, start: index * 400, end: index * 400 + 300 }));
  const paragraphs = groupTranscriptParagraphs(words, word => word.text !== 'deleted');
  assert.deepEqual(paragraphs.map(paragraph => paragraph.text), ['keep', 'payoff']);
  assert.ok(paragraphs.every(paragraph => wordMatchingQuery(paragraph, 'deleted') === null));
});

test('search seeks the word that matches within a paragraph', () => {
  const words = ['A', 'funny', 'payoff', 'lands'].map((text, index) => ({ text, start: index * 400, end: index * 400 + 300 }));
  const paragraph = groupTranscriptParagraphs(words)[0];
  assert.equal(wordMatchingQuery(paragraph, 'payoff lands')?.start, 800);
  assert.equal(wordMatchingQuery(paragraph, 'unny')?.start, 400);
});
