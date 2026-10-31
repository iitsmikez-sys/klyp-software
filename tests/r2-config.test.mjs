import assert from 'node:assert/strict';
import test from 'node:test';
import { r2Config, r2ObjectKey } from '../lib/r2-config.ts';

test('R2 stays disabled unless explicitly enabled', () => {
  assert.equal(r2Config({ R2_ENABLED: '0' }), null);
  assert.equal(r2Config({}), null);
});

test('enabled R2 refuses incomplete configuration without echoing secrets', () => {
  assert.throws(() => r2Config({ R2_ENABLED: '1', R2_SECRET_ACCESS_KEY: 'should-not-appear' }), (error) => {
    assert.doesNotMatch(error.message, /should-not-appear/);
    return /R2 configuration incomplete/.test(error.message);
  });
});

test('R2 keys are scoped to a UUID owner and reject traversal', () => {
  const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const upload = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  assert.equal(r2ObjectKey('vod', owner, upload, 'source.mp4'),
    `vod/${owner}/${upload}/source.mp4`);
  assert.throws(() => r2ObjectKey('vod', owner, upload, '../source.mp4'));
  assert.throws(() => r2ObjectKey('vod', '../owner', upload, 'source.mp4'));
});

test('jurisdictional buckets use their required S3 endpoint', () => {
  const base = { R2_ENABLED: '1', R2_BUCKET: 'klyp-staging',
    R2_ACCOUNT_ID: 'a'.repeat(32), R2_ACCESS_KEY_ID: 'local', R2_SECRET_ACCESS_KEY: 'local' };
  assert.equal(r2Config({ ...base, R2_JURISDICTION: 'eu' }).endpoint,
    `https://${base.R2_ACCOUNT_ID}.eu.r2.cloudflarestorage.com`);
  assert.throws(() => r2Config({ ...base, R2_JURISDICTION: 'unknown' }));
});
