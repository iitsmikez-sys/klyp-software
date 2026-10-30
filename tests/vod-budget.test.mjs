import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewProcessingBudget } from '../lib/vod-budget.ts';

test('cost guard never shortens the candidate plan silently', () => {
  const windows = [{ start: 0, end: 36000 }];
  const result = reviewProcessingBudget(windows, 1);
  assert.equal(result.requiresReview, true);
  assert.deepEqual(windows, [{ start: 0, end: 36000 }]);
});

test('normal candidate plan proceeds within a configured cost ceiling', () => {
  assert.equal(reviewProcessingBudget([{ start: 0, end: 120 }], 5).requiresReview, false);
});
