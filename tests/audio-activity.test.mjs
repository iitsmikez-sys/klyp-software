import test from 'node:test';
import assert from 'node:assert/strict';
import { activityFromEnergyFrames } from '../lib/audio-activity.ts';

test('audio onset after quiet proposes a candidate without selecting a clip', () => {
  const frames = Array.from({ length: 180 }, (_, i) => ({ seconds: i, rms: i >= 90 && i < 96 ? 8000 : 400 }));
  const points = activityFromEnergyFrames(frames);
  assert.ok(points.some(p => p.seconds >= 90 && p.seconds <= 96));
  assert.equal('clips' in points, false);
});

test('constant loud background does not dominate activity changes', () => {
  const frames = Array.from({ length: 180 }, (_, i) => ({ seconds: i, rms: 6000 }));
  assert.equal(activityFromEnergyFrames(frames).length, 0);
});
