import test from 'node:test';
import assert from 'node:assert/strict';
import { availableCachedClips, resultCacheKey, selectReviewedCachedClips } from '../lib/analysis-result-cache.ts';

const clip = start => ({ start_seconds: start, end_seconds: start + 30, viral_score: 80 });

test('an already judged candidate batch supplies later clips without another model call', () => {
  const remaining = availableCachedClips([clip(100), clip(200), clip(300)], [{ start_seconds: 100, end_seconds: 130 }], 2);
  assert.deepEqual(remaining.map(c => c.start_seconds), [200, 300]);
});

test('result cache distinguishes coverage and creator preferences', () => {
  const base = { sourceKey: 'twitch:123', durationSeconds: 3600, contentType: 'gaming', keyword: '',
    creatorPreferences: '', windows: [{ start: 0, end: 120 }] };
  assert.notEqual(resultCacheKey(base), resultCacheKey({ ...base, windows: [{ start: 0, end: 240 }] }));
  assert.notEqual(resultCacheKey(base), resultCacheKey({ ...base, creatorPreferences: 'more jokes' }));
  assert.notEqual(resultCacheKey(base), resultCacheKey({ ...base, priorWindows: [{ start_seconds: 100, end_seconds: 130 }] }));
});

test('cached results skip an invalid high-ranked cut and offer the next ready moment', () => {
  const candidate = (start_seconds, end_seconds) => ({ start_seconds, end_seconds,
    thumbnail_seconds: start_seconds + 10, title: 'Moment', reason: 'Complete reaction.', viral_score: 80 });
  const { clips, flagged } = selectReviewedCachedClips(
    [candidate(100, 166), candidate(300, 330)],
    [{ text: 'Setup.', start: 301000, end: 301300 }, { text: 'Done!', start: 325000, end: 325300 }],
    1000, [], 1,
  );
  assert.deepEqual(clips.map(item => item.start_seconds), [300]);
  assert.deepEqual(flagged[0].flags, ['duration_over_60s']);
});
