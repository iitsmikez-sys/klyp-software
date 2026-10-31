import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { archiveClipFilesToR2 } from '../lib/r2-clip-archive.ts';

const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const clip = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

test('all three original files are copied without re-encoding and verified before stored', async () => {
  const dir = await mkdtemp(path.join(process.cwd(), 'klyp-r2-archive-'));
  const remote = new Map();
  const store = {
    async putFile(key, file) { const bytes = await readFile(file); remote.set(key, bytes); return bytes.length; },
    async head(key) { return remote.has(key) ? { bytes: remote.get(key).length } : null; },
    async downloadFile(key, target) { const bytes = remote.get(key); await writeFile(target, bytes); return bytes.length; },
  };
  try {
    const assets = { master: path.join(dir, 'master.mp4'), proxy: path.join(dir, 'proxy.mp4'),
      poster: path.join(dir, 'poster.jpg') };
    await writeFile(assets.master, 'original-quality-master');
    await writeFile(assets.proxy, 'preview');
    await writeFile(assets.poster, 'thumbnail');
    const manifest = await archiveClipFilesToR2(owner, clip, assets, store, dir);
    assert.equal(manifest.length, 3);
    assert.equal(manifest[0].key, `clips/${owner}/${clip}/master.mp4`);
    assert.equal(remote.get(manifest[0].key).toString(), 'original-quality-master');
    assert.equal(manifest.reduce((sum, file) => sum + file.bytes, 0), 39);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a corrupt remote copy is rejected before the clip becomes stored', async () => {
  const dir = await mkdtemp(path.join(process.cwd(), 'klyp-r2-corrupt-'));
  const files = { master: path.join(dir, 'master.mp4'), proxy: path.join(dir, 'proxy.mp4'),
    poster: path.join(dir, 'poster.jpg') };
  await Promise.all(Object.values(files).map(file => writeFile(file, 'original')));
  const store = {
    async putFile() { return 8; },
    async head() { return { bytes: 8 }; },
    async downloadFile(_key, target) { await writeFile(target, 'corrupt!'); return 8; },
  };
  try {
    await assert.rejects(archiveClipFilesToR2(owner, clip, files, store, dir), /verification failed/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
