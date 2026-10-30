import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTranscript } from '../lib/format-transcript.ts';

test('a sparse transcript begins at its actual late VOD timestamp', () => {
  const text = formatTranscript([
    { start: 9 * 3600 * 1000, end: 9 * 3600 * 1000 + 500, text: 'late' },
    { start: 9 * 3600 * 1000 + 1000, end: 9 * 3600 * 1000 + 1500, text: 'payoff' },
  ]);
  assert.match(text, /^\[9:00:00\] late payoff$/);
});
