import test from 'node:test';
import assert from 'node:assert/strict';
import { planCandidateWindows } from '../lib/vod-candidates.ts';

test('candidate plan covers late and quiet hours of a ten-hour VOD', () => {
  const plan = planCandidateWindows(36000, [{ seconds: 600, intensity: 8 }], [], []);
  assert.ok(plan.windows.some(w => w.start <= 600 && w.end >= 600));
  assert.ok(plan.windows.some(w => w.start >= 9 * 3600));
  assert.equal(plan.hourlyCoverage.length, 10);
  assert.ok(plan.hourlyCoverage.every(Boolean));
});

test('an audio reaction with quiet chat is offered for Opus review', () => {
  const plan = planCandidateWindows(4 * 3600, [], [{ seconds: 3 * 3600 + 240, strength: 9 }], []);
  assert.ok(plan.windows.some(w => w.start <= 11040 && w.end >= 11040 && w.sources.includes('audio')));
  assert.equal('clips' in plan, false);
});

test('scene change alone is only a candidate signal and never a selected clip', () => {
  const plan = planCandidateWindows(3600, [], [], [{ seconds: 2220, strength: 10 }]);
  assert.ok(plan.windows.some(w => w.start <= 2220 && w.end >= 2220 && w.sources.includes('scene')));
  assert.equal('clips' in plan, false);
});

test('a late-hour chat spike survives when early hours have stronger spikes', () => {
  const chat = Array.from({ length: 20 }, (_, i) => ({ seconds: 600 + i * 60, intensity: 100 - i }));
  chat.push({ seconds: 9 * 3600 + 300, intensity: 2 });
  const plan = planCandidateWindows(36000, chat, [], []);
  assert.ok(plan.windows.some(w => w.sources.includes('chat') && w.start <= 9 * 3600 + 300 && w.end >= 9 * 3600 + 300));
});
