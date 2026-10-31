import assert from 'node:assert/strict';
import test from 'node:test';
import { R2Storage } from '../lib/r2.ts';

const config = { bucket: 'klyp-staging', accountId: 'a'.repeat(32),
  endpoint: `https://${'a'.repeat(32)}.r2.cloudflarestorage.com`,
  accessKeyId: 'local-test-key', secretAccessKey: 'local-test-secret' };

test('multipart completion rejects duplicate or missing parts before reaching R2', async () => {
  const calls = [];
  const store = new R2Storage(config, { send: async (command) => { calls.push(command); return {}; } });
  await assert.rejects(store.complete('vod/owner/id/source.mp4', 'upload-id',
    [{ partNumber: 1, etag: 'one' }, { partNumber: 1, etag: 'two' }]));
  await assert.rejects(store.complete('vod/owner/id/source.mp4', 'upload-id',
    [{ partNumber: 1, etag: 'one' }, { partNumber: 3, etag: 'three' }]));
  assert.equal(calls.length, 0);
});

test('multipart completion sends ordered parts and fails closed on missing R2 response', async () => {
  const calls = [];
  const store = new R2Storage(config, { send: async (command) => {
    calls.push(command);
    return {};
  } });
  await assert.rejects(store.complete('vod/owner/id/source.mp4', 'upload-id',
    [{ partNumber: 2, etag: 'two' }, { partNumber: 1, etag: 'one' }]));
  assert.deepEqual(calls[0].input.MultipartUpload.Parts,
    [{ PartNumber: 1, ETag: 'one' }, { PartNumber: 2, ETag: 'two' }]);
});

test('HEAD requires a known byte length before a backup is considered present', async () => {
  const store = new R2Storage(config, { send: async () => ({}) });
  assert.equal(await store.head('clips/owner/id/master.mp4'), null);
});
