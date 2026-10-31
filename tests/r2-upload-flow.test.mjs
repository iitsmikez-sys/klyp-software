import assert from 'node:assert/strict';
import test from 'node:test';
import { beginR2Upload, signR2UploadPart, finishR2Upload } from '../lib/r2-upload-flow.ts';

const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const stranger = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MB = 1024 * 1024;

function fixture() {
  const rows = new Map();
  const calls = [];
  let head = null;
  const repo = {
    async insert(row) { rows.set(row.id, row); },
    async get(id) { return rows.get(id) ?? null; },
    async markReady(id, seconds) { rows.set(id, { ...rows.get(id), status: 'ready', durationSeconds: seconds }); },
  };
  const r2 = {
    async createMultipart() { calls.push('create'); return 'remote-upload'; },
    async signPart(_key, _id, part) { calls.push(`sign:${part}`); return `https://r2.test/part/${part}`; },
    async listParts() { calls.push('list'); return [{ partNumber: 1, etag: 'one', bytes: 16 * MB },
      { partNumber: 2, etag: 'two', bytes: 1 * MB }]; },
    async complete() { calls.push('complete'); head = { bytes: 17 * MB, etag: 'remote' }; },
    async head() { calls.push('head'); return head; },
    async signedGet() { calls.push('get'); return 'https://r2.test/source'; },
    async abort() { calls.push('abort'); },
  };
  return { repo, r2, rows, calls, setHead(value) { head = value; } };
}

test('upload initiation rejects size overflow without starting remote work', async () => {
  const { repo, r2, calls } = fixture();
  await assert.rejects(beginR2Upload(owner, 'vod.mp4', 4 * 1024 ** 3 + 1, repo, r2));
  assert.deepEqual(calls, []);
});

test('part signing checks the owner and allowed part number', async () => {
  const { repo, r2, calls } = fixture();
  const upload = await beginR2Upload(owner, 'vod.mp4', 17 * MB, repo, r2);
  await assert.rejects(signR2UploadPart(stranger, upload.id, 1, repo, r2));
  await assert.rejects(signR2UploadPart(owner, upload.id, 3, repo, r2));
  assert.equal(await signR2UploadPart(owner, upload.id, 2, repo, r2), 'https://r2.test/part/2');
  assert.deepEqual(calls, ['create', 'sign:2']);
});

test('completion requires remote bytes before exposing a ready upload', async () => {
  const { repo, r2, rows } = fixture();
  const upload = await beginR2Upload(owner, 'vod.mp4', 17 * MB, repo, r2);
  r2.listParts = async () => [{ partNumber: 1, etag: 'one', bytes: 16 * MB }];
  await assert.rejects(finishR2Upload(owner, upload.id, repo, r2, async () => 60));
  assert.equal(rows.get(upload.id).status, 'uploading');
});

test('confirmed completion is idempotent across a new worker instance', async () => {
  const { repo, r2, calls } = fixture();
  const upload = await beginR2Upload(owner, 'vod.mp4', 17 * MB, repo, r2);
  const first = await finishR2Upload(owner, upload.id, repo, r2, async () => 72);
  const second = await finishR2Upload(owner, upload.id, repo, r2, async () => { throw Error('probe repeated'); });
  assert.deepEqual(first, { uploadId: upload.id, durationSeconds: 72 });
  assert.deepEqual(second, first);
  assert.equal(calls.filter(call => call === 'complete').length, 1);
});

test('restart after R2 completion can recover without re-completing multipart', async () => {
  const { repo, r2, calls, setHead } = fixture();
  const upload = await beginR2Upload(owner, 'vod.mp4', 17 * MB, repo, r2);
  setHead({ bytes: 17 * MB, etag: 'complete' });
  await finishR2Upload(owner, upload.id, repo, r2, async () => 90);
  assert.equal(calls.includes('complete'), false);
});

test('concurrent finalize requests converge on one ready upload', async () => {
  const { repo, r2, rows } = fixture();
  const upload = await beginR2Upload(owner, 'vod.mp4', 17 * MB, repo, r2);
  let firstHeads = 0;
  let completeCalls = 0;
  let ready = false;
  r2.head = async () => ++firstHeads <= 2 ? null : ready ? { bytes: 17 * MB } : null;
  r2.complete = async () => {
    completeCalls++;
    if (completeCalls === 1) { ready = true; return; }
    const error = new Error('already completed'); error.name = 'NoSuchUpload'; throw error;
  };
  repo.markReady = async (id, seconds) => {
    if (rows.get(id).status === 'ready') throw new Error('already finalized');
    rows.set(id, { ...rows.get(id), status: 'ready', durationSeconds: seconds });
  };
  const results = await Promise.all([
    finishR2Upload(owner, upload.id, repo, r2, async () => 90),
    finishR2Upload(owner, upload.id, repo, r2, async () => 90),
  ]);
  assert.deepEqual(results[0], results[1]);
  assert.equal(rows.get(upload.id).status, 'ready');
});
