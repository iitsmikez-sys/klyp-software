import assert from 'node:assert/strict';
import test from 'node:test';
import { uploadFileToR2 } from '../lib/r2-browser-upload.ts';

const file = new File(['abcdefghij'], 'vod.mp4', { type: 'video/mp4', lastModified: 10 });
const json = data => ({ ok: true, status: 200, async json() { return data; } });

test('direct upload resumes only missing parts after interrupted attempt', async () => {
  const cache = new Map();
  const calls = [];
  let completed = new Set();
  let failOnce = true;
  const api = async (path, init) => {
    const body = init?.body ? JSON.parse(init.body) : null;
    if (path.startsWith('/api/upload/r2?')) return json({ status: 'uploading',
      expectedBytes: 10, fileName: 'vod.mp4', partBytes: 5, completedParts: [...completed] });
    if (body?.action === 'start') return json({ id: 'resume-id', partBytes: 5, parts: 2 });
    if (body?.action === 'part') return json({ url: `https://r2.test/${body.partNumber}` });
    if (body?.action === 'finish') return json({ uploadId: 'resume-id', durationSeconds: 60, sparks: 10 });
    throw Error('unexpected API call');
  };
  const put = async (url, init) => {
    const part = Number(url.split('/').at(-1));
    calls.push([part, await init.body.text()]);
    if (part === 2 && failOnce) { failOnce = false; throw Error('network lost'); }
    completed.add(part);
    return { ok: true };
  };
  const storage = { getItem: key => cache.get(key) ?? null,
    setItem: (key, value) => cache.set(key, value), removeItem: key => cache.delete(key) };
  await assert.rejects(uploadFileToR2(file, api, put, storage, () => {}));
  const result = await uploadFileToR2(file, api, put, storage, () => {});
  assert.equal(result.uploadId, 'resume-id');
  assert.deepEqual(calls, [[1, 'abcde'], [2, 'fghij'], [2, 'fghij']]);
  assert.equal(cache.size, 0);
});

test('upload rejects a resumed session for a different file', async () => {
  const cache = new Map([['klyp-r2-upload:vod.mp4:10:10', 'old-id']]);
  const storage = { getItem: key => cache.get(key) ?? null,
    setItem: (key, value) => cache.set(key, value), removeItem: key => cache.delete(key) };
  const api = async (path, init) => path.startsWith('/api/upload/r2?')
    ? json({ status: 'uploading', expectedBytes: 99, fileName: 'vod.mp4', partBytes: 5, completedParts: [] })
    : json({ id: 'new-id', partBytes: 5, parts: 2 });
  await assert.rejects(uploadFileToR2(file, api, async () => { throw Error('stop'); }, storage, () => {}));
  assert.equal([...cache.values()][0], 'new-id');
});
