import test from 'node:test';
import assert from 'node:assert/strict';
import { missingCoverage, reusableWords, validCoverageSegment } from '../lib/transcript-coverage.ts';

const word = (text, start) => ({ text, start: start * 1000, end: (start + 1) * 1000 });

test('partially transcribed VOD reports the exact uncovered timestamps', () => {
  assert.deepEqual(missingCoverage([{ start: 0, end: 1000 }], [{ start: 0, end: 200 }]), [{ start: 200, end: 1000 }]);
  assert.deepEqual(missingCoverage([{ start: 0, end: 1000 }], [{ start: 0, end: 200 }, { start: 400, end: 600 }]),
    [{ start: 200, end: 400 }, { start: 600, end: 1000 }]);
});

test('cached words outside recorded coverage are not reused', () => {
  const words = reusableWords([{ start: 100, end: 200, words: [word('yes', 120), word('wrong', 250)] }], [{ start: 110, end: 150 }]);
  assert.deepEqual(words.map(w => w.text), ['yes']);
});

test('cache rejects wrong VOD duration, version, model, and incomplete audio', () => {
  const row = { start: 100, end: 160, actualAudioSeconds: 60, vodSeconds: 3600, version: 'v2', model: 'u35', words: [] };
  assert.equal(validCoverageSegment(row, 3600, 'v2', 'u35'), true);
  assert.equal(validCoverageSegment({ ...row, actualAudioSeconds: 40 }, 3600, 'v2', 'u35'), false);
  assert.equal(validCoverageSegment({ ...row, vodSeconds: 7200 }, 3600, 'v2', 'u35'), false);
  assert.equal(validCoverageSegment(row, 3600, 'v3', 'u35'), false);
  assert.equal(validCoverageSegment(row, 3600, 'v2', 'u2'), false);
});
