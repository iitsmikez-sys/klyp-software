import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, stat, utimes, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { materializeR2Upload, cleanupR2Scratch } from '../lib/r2-upload-source.ts';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const row = { id, userId: id, key: `vod/${id}/${id}/source.mp4`,
  expectedBytes: 6, status: 'ready' };

test('restart with no local copy restores verified bytes from R2', async () => {
  const dir = await mkdtemp(path.join(process.cwd(), 'klyp-r2-source-'));
  let downloads = 0;
  const r2 = { async head() { return { bytes: 6 }; }, async downloadFile(_key, target) {
    downloads++; await writeFile(target, 'source'); return 6;
  } };
  try {
    const first = await materializeR2Upload(row, r2, dir, async () => 10 ** 10);
    assert.equal(await readFile(first, 'utf8'), 'source');
    const restarted = await materializeR2Upload(row, r2, dir, async () => 10 ** 10);
    assert.equal(restarted, first);
    assert.equal(downloads, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('wrong remote byte length never creates a usable source file', async () => {
  const dir = await mkdtemp(path.join(process.cwd(), 'klyp-r2-bad-'));
  try {
    await assert.rejects(materializeR2Upload(row,
      { async head() { return { bytes: 5 }; }, async downloadFile() { throw Error('should not download'); } },
      dir, async () => 10 ** 10));
    assert.deepEqual(await readdir(dir), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('scratch cleanup skips fresh files and deletes expired temporary source', async () => {
  const dir = await mkdtemp(path.join(process.cwd(), 'klyp-r2-cleanup-'));
  try {
    const old = path.join(dir, `upload-${id}.mp4`);
    const fresh = path.join(dir, 'upload-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.mp4');
    await writeFile(old, 'old'); await writeFile(fresh, 'fresh');
    await utimes(old, new Date(0), new Date(0));
    await cleanupR2Scratch(dir, Date.now(), 24 * 60 * 60_000);
    await assert.rejects(stat(old));
    assert.equal((await stat(fresh)).size, 5);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
