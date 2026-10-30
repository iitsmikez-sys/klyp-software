import test from 'node:test';
import assert from 'node:assert/strict';
import { compareRuns } from '../scripts/compare-discovery.mjs';

const rated = (start, end, rating) => ({ start, end, relevance: rating, context: rating,
  payoff: rating, editing: rating });

test('quality comparison rejects a cheaper run that misses a known moment', () => {
  const report = compareRuns({ vodSeconds: 7200,
    gold: [{ id: 'late-payoff', start: 7000, end: 7030 }],
    baseline: { clips: [rated(6995, 7035, 5)], costUsd: 1, processingSeconds: 100 },
    candidate: { clips: [rated(100, 130, 5)], costUsd: 0.5, processingSeconds: 80 },
  });
  assert.equal(report.qualityRegression, true);
  assert.deepEqual(report.candidate.foundIds, []);
});

test('quality comparison needs human context and payoff ratings', () => {
  assert.throws(() => compareRuns({ vodSeconds: 3600, gold: [{ id: 'a', start: 10, end: 30 }],
    baseline: { clips: [{ start: 10, end: 30 }], costUsd: 1, processingSeconds: 10 },
    candidate: { clips: [rated(10, 30, 5)], costUsd: 1, processingSeconds: 10 },
  }), /human ratings/);
});
