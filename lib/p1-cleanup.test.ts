import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestTranscriptCleanup, applyTranscriptCleanup } from './transcript-edits.ts';

test('offers bounded filler cuts only inside kept footage', () => {
  const words = [
    { text: 'Hi', start: 100000, end: 100300 },
    { text: 'um', start: 100500, end: 100800 },
    { text: 'there', start: 101100, end: 101500 },
    { text: 'um', start: 104000, end: 104300 },
  ];
  const result = suggestTranscriptCleanup(words, 100, [{ id: 'a', start_seconds: 100, end_seconds: 103 }], null, 3);
  assert.equal(result.filter(item => item.kind === 'filler').length, 1);
  assert.equal(result[0].start_seconds, 100.5);
  assert.equal(result[0].end_seconds, 100.8);
});

test('quiet pause suggestions require a quiet waveform and are mapped through existing cuts', () => {
  const words = [{ text: 'first', start: 100000, end: 100400 }, { text: 'second', start: 103000, end: 103400 }];
  const segment = [{ id: 'a', start_seconds: 100, end_seconds: 104 }];
  const quiet = suggestTranscriptCleanup(words, 100, segment, Array(40).fill(0), 4);
  assert.equal(quiet.filter(item => item.kind === 'pause').length, 1);
  const loud = suggestTranscriptCleanup(words, 100, segment, Array(40).fill(0.8), 4);
  assert.equal(loud.filter(item => item.kind === 'pause').length, 0);
});

test('applying multiple reviewed cuts preserves source order and never erases the full clip', () => {
  const source = [{ id: 'a', start_seconds: 100, end_seconds: 106 }];
  const candidates = [
    { kind: 'filler' as const, start_seconds: 101, end_seconds: 101.3, label: 'um' },
    { kind: 'pause' as const, start_seconds: 103, end_seconds: 104, label: 'Pause' },
  ];
  const result = applyTranscriptCleanup(source, candidates);
  assert.deepEqual(result.map(item => [item.start_seconds, item.end_seconds]), [[100, 101], [101.3, 103], [104, 106]]);
  assert.equal(new Set(result.map(item => item.id)).size, 3);
  assert.deepEqual(applyTranscriptCleanup(source, [{ ...candidates[0], start_seconds: 100, end_seconds: 106 }]), source);
  const again = applyTranscriptCleanup(result, [{ ...candidates[0], start_seconds: 100.4, end_seconds: 100.6 }]);
  assert.equal(again.length, 4);
  assert.equal(new Set(again.map(item => item.id)).size, 4);
});
