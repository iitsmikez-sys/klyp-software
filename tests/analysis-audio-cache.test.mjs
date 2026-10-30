import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { ensureCachedAnalysisAudio } from '../lib/analysis-audio-cache.ts';

test('repeated and concurrent requests reuse one complete audio download', async () => {
  const dir = await mkdtemp(path.join(process.cwd(), '.klyp-cache-test-'));
  try {
    let creates = 0;
    const create = async target => { creates++; await new Promise(r => setTimeout(r, 20)); await writeFile(target, Buffer.from('audio data')); };
    const options = { cacheDir: dir, userId: 'user-1', sourceKey: 'twitch:123', durationSeconds: 3600, create };
    const [first, second] = await Promise.all([ensureCachedAnalysisAudio(options), ensureCachedAnalysisAudio(options)]);
    assert.equal(first.path, second.path);
    assert.equal(creates, 1);
    assert.equal((await ensureCachedAnalysisAudio(options)).cacheHit, true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a duration change invalidates cached source audio', async () => {
  const dir = await mkdtemp(path.join(process.cwd(), '.klyp-cache-test-'));
  try {
    let creates = 0;
    const create = async target => { creates++; await writeFile(target, Buffer.from('audio data')); };
    await ensureCachedAnalysisAudio({ cacheDir: dir, userId: 'user-1', sourceKey: 'twitch:123', durationSeconds: 3600, create });
    await ensureCachedAnalysisAudio({ cacheDir: dir, userId: 'user-1', sourceKey: 'twitch:123', durationSeconds: 7200, create });
    assert.equal(creates, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
