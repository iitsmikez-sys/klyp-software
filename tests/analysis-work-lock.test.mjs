import test from 'node:test';
import assert from 'node:assert/strict';
import { withSourceWorkLock } from '../lib/analysis-work-lock.ts';

test('same source cannot start overlapping paid analysis, and lock releases after failure', async () => {
  let release;
  const first = withSourceWorkLock('user:vod', () => new Promise(resolve => { release = resolve; }));
  await assert.rejects(withSourceWorkLock('user:vod', async () => 'duplicate'), /already being analyzed/);
  release('first');
  assert.equal(await first, 'first');
  await assert.rejects(withSourceWorkLock('user:vod', async () => { throw new Error('failed'); }), /failed/);
  assert.equal(await withSourceWorkLock('user:vod', async () => 'retry'), 'retry');
});
