import assert from 'node:assert/strict';
import test from 'node:test';
import { unseenVods } from '../lib/vod-discovery.ts';

const videos = [
  { id: '105', created_at: '2026-10-30T05:00:00Z' },
  { id: '104', created_at: '2026-10-30T04:00:00Z' },
  { id: '103', created_at: '2026-10-30T03:00:00Z' },
];

test('a reconnect discovers every newer VOD in publication order', () => {
  assert.deepEqual(unseenVods(videos, '102', '2026-10-30T02:00:00Z').map(v => v.id), ['103', '104', '105']);
  assert.deepEqual(unseenVods(videos, '105', '2026-10-30T02:00:00Z'), []);
});

test('a new connection skips archives published before it was connected', () => {
  assert.deepEqual(unseenVods(videos, null, '2026-10-30T03:30:00Z').map(v => v.id), ['104', '105']);
});
