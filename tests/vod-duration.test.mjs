import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyVodDuration } from '../lib/vod-duration.ts';

test('accepts ordinary container duration drift', () => {
  assert.equal(verifyVodDuration(36000, 35700), 35700);
});

test('rejects a truncated long VOD rather than silently missing its late moments', () => {
  assert.throws(() => verifyVodDuration(36000, 30000), /incomplete/);
});
