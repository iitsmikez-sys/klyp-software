import assert from 'node:assert/strict';
import test from 'node:test';
import { signWorkerTokenRequest, verifyWorkerTokenRequest, workerTokenEndpoint,
  requestWorkerAccessToken } from '../lib/youtube-worker-token.ts';

const postId = '11111111-1111-4111-8111-111111111111';
const key = 'shared-service-secret';
const now = 1_793_450_000_000;

test('accepts a signed request for one post within a short time window', () => {
  const timestamp = String(now);
  const signature = signWorkerTokenRequest(postId, timestamp, key);
  assert.equal(verifyWorkerTokenRequest(postId, timestamp, signature, key, now), true);
  assert.equal(verifyWorkerTokenRequest('22222222-2222-4222-8222-222222222222', timestamp, signature, key, now), false);
  assert.equal(verifyWorkerTokenRequest(postId, timestamp, signature, 'different-key', now), false);
});

test('rejects expired, future, malformed, and missing signatures', () => {
  const timestamp = String(now);
  const signature = signWorkerTokenRequest(postId, timestamp, key);
  assert.equal(verifyWorkerTokenRequest(postId, timestamp, signature, key, now + 121_000), false);
  assert.equal(verifyWorkerTokenRequest(postId, timestamp, signature, key, now - 121_000), false);
  assert.equal(verifyWorkerTokenRequest(postId, 'oops', signature, key, now), false);
  assert.equal(verifyWorkerTokenRequest(postId, timestamp, '', key, now), false);
  assert.equal(verifyWorkerTokenRequest('not-a-uuid', timestamp, signature, key, now), false);
});

test('broker endpoint uses only the configured Klyp callback origin', () => {
  assert.equal(workerTokenEndpoint('https://www.klyp.world/api/youtube/callback'),
    'https://www.klyp.world/api/youtube/worker-token');
  assert.throws(() => workerTokenEndpoint('http://example.com/api/youtube/callback'));
});

test('worker requests a token for the exact post with a signed, uncached request', async () => {
  const previousSecret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const previousRedirect = process.env.YOUTUBE_REDIRECT_URI;
  process.env.SUPABASE_SERVICE_ROLE_KEY = key;
  process.env.YOUTUBE_REDIRECT_URI = 'https://www.klyp.world/api/youtube/callback';
  try {
    const token = await requestWorkerAccessToken(postId, async (url, init) => {
      assert.equal(url, 'https://www.klyp.world/api/youtube/worker-token');
      assert.equal(init.cache, 'no-store');
      assert.equal(JSON.parse(init.body).postId, postId);
      assert.equal(verifyWorkerTokenRequest(postId, init.headers['x-klyp-token-timestamp'],
        init.headers['x-klyp-token-signature'], key), true);
      return Response.json({ accessToken: 'short-lived' });
    });
    assert.equal(token, 'short-lived');
  } finally {
    if (previousSecret === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousSecret;
    if (previousRedirect === undefined) delete process.env.YOUTUBE_REDIRECT_URI;
    else process.env.YOUTUBE_REDIRECT_URI = previousRedirect;
  }
});
