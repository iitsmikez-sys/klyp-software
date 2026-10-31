import test from 'node:test';
import assert from 'node:assert/strict';
import { groupCaptionCues } from './editor-caption-groups.ts';
import type { CaptionCue } from './editor-timeline.ts';

const words: CaptionCue[] = Array.from({ length: 144 }, (_, index) => ({
  id: `word-${index}`, text: `word${index}`,
  start_ms: index * 320, end_ms: index * 320 + 240,
}));

test('normal timeline zoom shows readable phrases without losing word selections', () => {
  const groups = groupCaptionCues(words, 1);
  assert.ok(groups.length >= 8 && groups.length <= 24, `Expected a compact phrase track, got ${groups.length} blocks`);
  assert.deepEqual(groups.flatMap(group => group.cues.map(cue => cue.id)), words.map(word => word.id));
  assert.equal(groups[0].text, groups[0].cues.map(cue => cue.text).join(' '));
  assert.ok(groups.every(group => group.end_ms > group.start_ms));
});

test('zoom reveals shorter groups and pauses separate phrases', () => {
  const cues = [
    { id: 'a', text: 'Wait', start_ms: 0, end_ms: 300 },
    { id: 'b', text: 'for it.', start_ms: 320, end_ms: 800 },
    { id: 'c', text: 'Now!', start_ms: 2200, end_ms: 2700 },
  ];
  assert.deepEqual(groupCaptionCues(cues, 1).map(group => group.cues.map(cue => cue.id)), [['a', 'b'], ['c']]);
  assert.ok(groupCaptionCues(words, 4).length > groupCaptionCues(words, 1).length);
});

test('empty captions make no phrase blocks', () => {
  assert.deepEqual(groupCaptionCues([], 1), []);
});
