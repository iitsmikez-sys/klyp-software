import test from 'node:test';
import assert from 'node:assert/strict';
import { chatSampleOffsets, selectChatSpikes } from '../lib/twitch-chat.ts';

test('chat samples cover the end of a ten-hour VOD without exceeding the request cap', () => {
  const offsets = chatSampleOffsets(10 * 3600);
  assert.equal(offsets.length, 400);
  assert.equal(offsets[0], 0);
  assert.ok(offsets.at(-1) >= 10 * 3600 - 60);
  assert.ok(offsets.every((value, index) => index === 0 || value > offsets[index - 1]));
});

test('short VODs retain one chat sample per minute', () => {
  assert.deepEqual(chatSampleOffsets(5 * 60), [0, 60, 120, 180, 240]);
});

test('chat spike ranking retains a late-hour spike even when early activity dominates', () => {
  const points = Array.from({ length: 20 }, (_, i) => ({ seconds: i * 60, intensity: 20 - i }));
  points.push({ seconds: 9 * 3600, intensity: 1 });
  assert.ok(selectChatSpikes(points).some(p => p.seconds === 9 * 3600));
});
