import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { migrateClipMedia } from '../lib/r2-clip-migration.ts';

const clip = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  masterPath: 'old/master.mp4', proxyPath: 'old/proxy.mp4', posterPath: 'old/poster.jpg' };

function fixture(missing = '') {
  const originals = new Map([['old/master.mp4', Buffer.from('master')],
    ['old/proxy.mp4', Buffer.from('proxy')], ['old/poster.jpg', Buffer.from('poster')]]);
  if (missing) originals.delete(missing);
  const copied = new Map();
  let commits = 0;
  return {
    source: { async read(key) { return originals.get(key) ?? null; } },
    target: {
      async putFile(key, file) { const bytes = await readFile(file); copied.set(key, bytes); return bytes.length; },
      async head(key) { return copied.has(key) ? { bytes: copied.get(key).length } : null; },
      async downloadFile(key, target) { const bytes = copied.get(key); await writeFile(target, bytes); return bytes.length; },
    },
    record: { async commit() { commits++; } },
    copied, get commits() { return commits; }, originals,
  };
}

test('default migration dry-run reads originals but does not copy or update the pointer', async () => {
  const f = fixture();
  const result = await migrateClipMedia(clip, f.source, f.target, f.record);
  assert.equal(result, 'ready');
  assert.equal(f.copied.size, 0);
  assert.equal(f.commits, 0);
  assert.equal(f.originals.size, 3);
});

test('missing original prevents migration without modifying storage', async () => {
  const f = fixture('old/proxy.mp4');
  const result = await migrateClipMedia(clip, f.source, f.target, f.record, { apply: true });
  assert.equal(result, 'missing');
  assert.equal(f.copied.size, 0);
  assert.equal(f.commits, 0);
});

test('verified copy changes pointer but never deletes Supabase originals', async () => {
  const f = fixture();
  const result = await migrateClipMedia(clip, f.source, f.target, f.record, { apply: true });
  assert.equal(result, 'migrated');
  assert.equal(f.copied.size, 3);
  assert.equal(f.commits, 1);
  assert.equal(f.originals.size, 3);
});
