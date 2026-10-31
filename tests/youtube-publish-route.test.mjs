import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../app/api/youtube/publish/route.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
} }).outputText;
const user = '11111111-1111-4111-8111-111111111111';
const clip = '22222222-2222-4222-8222-222222222222';
const requestKey = '33333333-3333-4333-8333-333333333333';

function setup({ pro = true, ownsClip = true, saveFails = false, scheduleExpiresBeforeUpload = false } = {}) {
  let renders = 0;
  let uploads = 0;
  let savedPost;
  let updates = 0;
  let validations = 0;
  const admin = { from(table) {
    if (table === 'clips') return { select() { return this; }, eq() { return this; },
      async maybeSingle() { return { data: ownsClip ? { id: clip } : null, error: null }; } };
    if (table === 'youtube_connections') return { select() { return this; }, eq() { return this; },
      async maybeSingle() { return { data: { refresh_token_enc: 'encrypted' }, error: null }; } };
    if (table === 'youtube_posts') return {
      insert(row) { savedPost = row; return this; }, select() { return this; }, eq() { return this; },
      async single() { return { data: { id: 'post-1' }, error: null }; },
      update(row) { savedPost = { ...savedPost, ...row }; return {
        async eq() { updates++; return { error: saveFails && updates === 1 ? { message: 'database unavailable' } : null }; },
      }; },
    };
    throw new Error(`Unexpected table ${table}`);
  } };
  const modules = {
    'next/server': { NextRequest: Request, NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/app/api/clip/route': { POST: async request => {
      renders++;
      const payload = await request.json();
      assert.equal(payload.clip_id, clip);
      assert.equal(payload.raw, false);
      assert.equal(payload.upscale, false);
      return new Response(Buffer.from('fake-mp4'), { headers: { 'Content-Type': 'video/mp4' } });
    } },
    '@/lib/supabase/admin': { createAdminClient: () => admin },
    '@/lib/profile-token': { bearerToken: () => 'token', getProfileFromToken: async () =>
      ({ id: user, tier: pro ? 'pro' : 'free', stripe_subscription_id: pro ? 'sub_123' : null }) },
    '@/lib/cors': { withCors: response => response, corsPreflight: () => new Response(null, { status: 204 }) },
    '@/lib/youtube-config': { youtubeConfig: () => ({}), youtubeTokenKey: () => 'key' },
    '@/lib/youtube-api': { refreshYouTubeAccessToken: async () => 'access', uploadToYouTube: async input => {
      uploads++;
      assert.equal(input.publishAt, '2026-10-31T12:00:00.000Z');
      assert.equal(input.bytes.toString(), 'fake-mp4');
      return 'youtube-video';
    }, YouTubeUploadError: class extends Error {} },
    '@/lib/youtube-publishing': { decryptRefreshToken: () => 'refresh',
      isConfirmedPro: profile => profile?.tier === 'pro' && !!profile.stripe_subscription_id,
      validateYouTubePost: input => {
        validations++;
        if (scheduleExpiresBeforeUpload && validations > 1) throw new Error('Schedule at least 10 minutes in the future.');
        return { title: input.title, description: input.description,
          publishAt: new Date(input.publishAt).toISOString() };
      } },
  };
  const exports = {};
  vm.runInNewContext(code, { exports, require: name => {
    if (!(name in modules)) throw new Error(`Unexpected import ${name}`);
    return modules[name];
  }, process: { env: { DEPLOYMENT_TARGET: 'processing' } }, Buffer, URL, Date, Request, Response, JSON, console });
  const request = new Request('https://processing.example/api/youtube/publish', {
    method: 'POST', headers: { Authorization: 'Bearer token' },
    body: JSON.stringify({ requestKey, clipPayload: { clip_id: clip, raw: true, upscale: true },
      title: 'Clip', description: '', publishAt: '2026-10-31T12:00:00Z' }),
  });
  return { post: () => exports.POST(request), calls: () => ({ renders, uploads, savedPost }) };
}

test('Free accounts cannot publish or trigger rendering', async () => {
  const testCase = setup({ pro: false });
  assert.equal((await testCase.post()).status, 403);
  assert.deepEqual(testCase.calls(), { renders: 0, uploads: 0, savedPost: undefined });
});

test('a Pro account cannot publish another user’s clip', async () => {
  const testCase = setup({ ownsClip: false });
  assert.equal((await testCase.post()).status, 404);
  assert.equal(testCase.calls().renders, 0);
  assert.equal(testCase.calls().uploads, 0);
});

test('an owned Pro clip is rendered safely and scheduled on YouTube', async () => {
  const testCase = setup();
  const response = await testCase.post();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).youtubeUrl, 'https://www.youtube.com/watch?v=youtube-video');
  assert.equal(testCase.calls().renders, 1);
  assert.equal(testCase.calls().uploads, 1);
  assert.equal(testCase.calls().savedPost.status, 'scheduled');
});

test('a post accepted by YouTube is never marked safe to retry after a database save failure', async () => {
  const testCase = setup({ saveFails: true });
  const response = await testCase.post();
  assert.equal(response.status, 502);
  assert.equal((await response.json()).status, 'needs_review');
  assert.equal(testCase.calls().savedPost.status, 'needs_review');
  assert.equal(testCase.calls().savedPost.youtube_video_id, 'youtube-video');
});

test('a scheduled time that expires during rendering is not sent to YouTube', async () => {
  const testCase = setup({ scheduleExpiresBeforeUpload: true });
  const response = await testCase.post();
  assert.equal(response.status, 500);
  assert.equal(testCase.calls().renders, 1);
  assert.equal(testCase.calls().uploads, 0);
  assert.equal(testCase.calls().savedPost.status, 'failed');
});
