import test from 'node:test';
import assert from 'node:assert/strict';
import { clipInsideObservedCoverage } from '../lib/vod-candidates.ts';

test('Opus selections are rejected when their setup or payoff falls in unobserved footage', () => {
  const windows = [{ start: 100, end: 220 }, { start: 500, end: 620 }];
  assert.equal(clipInsideObservedCoverage({ start_seconds: 130, end_seconds: 180 }, windows), true);
  assert.equal(clipInsideObservedCoverage({ start_seconds: 210, end_seconds: 230 }, windows), false);
  assert.equal(clipInsideObservedCoverage({ start_seconds: 300, end_seconds: 330 }, windows), false);
  assert.equal(clipInsideObservedCoverage({ start_seconds: 200, end_seconds: 510 }, windows), false);
});
