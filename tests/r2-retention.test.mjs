import assert from 'node:assert/strict';
import test from 'node:test';
import { processR2CleanupJob } from '../lib/r2-retention.ts';

test('cleanup deletes a due object and confirms remote absence before marking done', async () => {
  const calls = [];
  let exists = true;
  const queue = { async claim() { return { id: 7, key: 'clips/a/b/master.mp4', operation: 'delete', remoteId: null }; },
    async finish(id) { calls.push(['finish', id]); }, async fail() { throw Error('unexpected'); } };
  const store = { async delete(key) { calls.push(['delete', key]); exists = false; },
    async head() { return exists ? { bytes: 10 } : null; }, async abort() {} };
  assert.equal(await processR2CleanupJob(queue, store), true);
  assert.deepEqual(calls, [['delete', 'clips/a/b/master.mp4'], ['finish', 7]]);
});

test('failed deletion stays retryable and never claims success', async () => {
  const calls = [];
  const queue = { async claim() { return { id: 8, key: 'vod/a/b/source.mp4', operation: 'delete', remoteId: null }; },
    async finish() { calls.push('finish'); }, async fail(id) { calls.push(['fail', id]); } };
  const store = { async delete() { throw Error('offline'); }, async head() { return { bytes: 1 }; }, async abort() {} };
  assert.equal(await processR2CleanupJob(queue, store), true);
  assert.deepEqual(calls, [['fail', 8]]);
});

test('unfinished multipart is aborted; a completed stray object is also removed', async () => {
  const calls = [];
  let exists = true;
  const queue = { async claim() { return { id: 9, key: 'vod/a/b/source.mp4', operation: 'abort', remoteId: 'multipart' }; },
    async finish() { calls.push('finish'); }, async fail() { calls.push('fail'); } };
  const store = { async abort() { calls.push('abort'); }, async head() { return exists ? { bytes: 5 } : null; },
    async delete() { calls.push('delete'); exists = false; } };
  await processR2CleanupJob(queue, store);
  assert.deepEqual(calls, ['abort', 'delete', 'finish']);
});
