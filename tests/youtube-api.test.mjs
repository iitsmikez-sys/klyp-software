import assert from 'node:assert/strict';
import test from 'node:test';
import { youtubeConsentUrl, exchangeYouTubeCode, refreshYouTubeAccessToken, revokeYouTubeToken, uploadToYouTube, YouTubeUploadError } from '../lib/youtube-api.ts';

const config = { clientId: 'client-id', clientSecret: 'client-secret', redirectUri: 'https://klyp.example/api/youtube/callback' };

test('YouTube consent requests only upload scope and offline access', () => {
  const url = new URL(youtubeConsentUrl(config, 'random-state'));
  assert.equal(url.hostname, 'accounts.google.com');
  assert.equal(url.searchParams.get('scope'), 'https://www.googleapis.com/auth/youtube.upload');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('state'), 'random-state');
  assert.equal(url.searchParams.get('redirect_uri'), config.redirectUri);
});

test('OAuth exchange requires a refresh token for scheduling', async () => {
  const fetcher = async (_url, request) => {
    assert.equal(new URLSearchParams(request.body).get('code'), 'code');
    return Response.json({ access_token: 'access', refresh_token: 'refresh' });
  };
  assert.deepEqual(await exchangeYouTubeCode(config, 'code', fetcher), { accessToken: 'access', refreshToken: 'refresh' });
  await assert.rejects(exchangeYouTubeCode(config, 'code', async () => Response.json({ access_token: 'access' })), /refresh token/i);
});

test('refresh token gets a new access token without exposing it', async () => {
  const token = await refreshYouTubeAccessToken(config, 'refresh', async (_url, request) => {
    assert.equal(new URLSearchParams(request.body).get('refresh_token'), 'refresh');
    return Response.json({ access_token: 'new-access' });
  });
  assert.equal(token, 'new-access');
});

test('disconnect revokes the refresh token and preserves connection on provider errors', async () => {
  await revokeYouTubeToken('refresh', async (url, request) => {
    assert.equal(url, 'https://oauth2.googleapis.com/revoke');
    assert.equal(request.method, 'POST');
    assert.equal(new URLSearchParams(request.body).get('token'), 'refresh');
    return new Response(null, { status: 200 });
  });
  await assert.rejects(revokeYouTubeToken('refresh', async () => new Response(null, { status: 503 })), /could not disconnect/i);
});

test('scheduled upload uses private status and native publishAt', async () => {
  const publishAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
  const calls = [];
  const fetcher = async (url, request) => {
    calls.push({ url, request });
    if (calls.length === 1) return new Response(null, { status: 200,
      headers: { Location: 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=abc' } });
    return Response.json({ id: 'video123' });
  };
  const id = await uploadToYouTube({ accessToken: 'access', bytes: Buffer.from('fake mp4'),
    title: 'Clip', description: 'Funny moment', publishAt, privacyStatus: 'public' }, fetcher);
  assert.equal(id, 'video123');
  const metadata = JSON.parse(calls[0].request.body);
  assert.equal(metadata.status.privacyStatus, 'private');
  assert.equal(metadata.status.publishAt, publishAt);
  assert.equal(calls[1].request.method, 'PUT');
  assert.equal(calls[1].request.headers.Authorization, 'Bearer access');
});

test('immediate upload is rejected before contacting YouTube', async () => {
  let count = 0;
  const fetcher = async () => { count++; throw new Error('No upload should start'); };
  await assert.rejects(uploadToYouTube({ accessToken: 'access', bytes: Buffer.from('mp4'),
    title: 'Clip', description: '', publishAt: null, privacyStatus: 'public' }, fetcher), /schedule/i);
  assert.equal(count, 0);
});

test('scheduled upload rejects foreign upload session URLs', async () => {
  let count = 0;
  await assert.rejects(uploadToYouTube({ accessToken: 'access', bytes: Buffer.from('mp4'),
    title: 'Clip', description: '', publishAt: new Date(Date.now() + 60 * 60_000).toISOString(), privacyStatus: 'public' },
  async () => { count++; return new Response(null, { status: 200,
    headers: { Location: 'https://attacker.example/upload' } }); }), /upload session/i);
  assert.equal(count, 1);
});

test('rejected upload initialization is safe to retry; uncertain completion is not', async () => {
  const input = { accessToken: 'access', bytes: Buffer.from('mp4'), title: 'Clip', description: '',
    publishAt: new Date(Date.now() + 60 * 60_000).toISOString(), privacyStatus: 'public' };
  await assert.rejects(uploadToYouTube(input, async () => new Response(null, { status: 401 })),
    error => error instanceof YouTubeUploadError && error.mayHaveReachedYouTube === false);
  let calls = 0;
  await assert.rejects(uploadToYouTube(input, async () => {
    calls++;
    if (calls === 1) return new Response(null, { status: 200,
      headers: { Location: 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=abc' } });
    throw new Error('connection dropped');
  }), error => error instanceof YouTubeUploadError && error.mayHaveReachedYouTube === true);
});

test('an upload finishing too close to scheduled time requires review and keeps the video ID', async () => {
  let count = 0;
  const fetcher = async () => {
    count++;
    return count === 1
      ? new Response(null, { status: 200, headers: { Location: 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=abc' } })
      : Response.json({ id: 'already-uploaded' });
  };
  await assert.rejects(uploadToYouTube({ accessToken: 'access', bytes: Buffer.from('mp4'), title: 'Clip',
    description: '', publishAt: new Date(Date.now() + 60_000).toISOString() }, fetcher),
    error => error instanceof YouTubeUploadError && error.mayHaveReachedYouTube && error.videoId === 'already-uploaded');
});
