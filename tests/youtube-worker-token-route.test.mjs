import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { signWorkerTokenRequest, verifyWorkerTokenRequest } from '../lib/youtube-worker-token.ts';

const source = readFileSync(new URL('../app/api/youtube/worker-token/route.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
} }).outputText;
const postId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';

function setup({ validSignature = true, status = 'processing', connected = true } = {}) {
  let refreshes = 0;
  let queries = 0;
  const admin = { from(table) {
    queries++;
    if (table === 'youtube_posts') return { select() { return this; }, eq() { return this; },
      async maybeSingle() { return { data: { user_id: userId, status }, error: null }; } };
    if (table === 'youtube_connections') return { select() { return this; }, eq() { return this; },
      async maybeSingle() { return { data: connected ? { refresh_token_enc: 'ciphertext' } : null, error: null }; } };
    throw new Error(`Unexpected table ${table}`);
  } };
  const modules = {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/supabase/admin': { createAdminClient: () => admin },
    '@/lib/youtube-api': { refreshYouTubeAccessToken: async () => { refreshes++; return 'short-lived-access'; } },
    '@/lib/youtube-config': { youtubeConfig: () => ({}), youtubeTokenKey: () => 'key' },
    '@/lib/youtube-publishing': { decryptRefreshToken: () => 'refresh' },
    '@/lib/youtube-worker-token': { verifyWorkerTokenRequest },
  };
  const exports = {};
  vm.runInNewContext(code, { exports, require: name => {
    if (!(name in modules)) throw new Error(`Unexpected import ${name}`);
    return modules[name];
  }, process: { env: { YOUTUBE_WORKER_SIGNING_KEY: 'shared-secret', DEPLOYMENT_TARGET: 'processing' } }, Request, Response, JSON, console });
  const timestamp = String(Date.now());
  const request = new Request('https://www.klyp.world/api/youtube/worker-token', {
    method: 'POST', headers: { 'x-klyp-token-timestamp': timestamp,
      'x-klyp-token-signature': validSignature
        ? signWorkerTokenRequest(postId, timestamp, 'shared-secret') : 'bad-signature' },
    body: JSON.stringify({ postId }),
  });
  return { post: () => exports.POST(request), calls: () => ({ queries, refreshes }) };
}

test('rejects invalid worker signatures before reading connections', async () => {
  const case1 = setup({ validSignature: false });
  assert.equal((await case1.post()).status, 401);
  assert.deepEqual(case1.calls(), { queries: 0, refreshes: 0 });
});

test('only an active post can obtain a short-lived token', async () => {
  const case1 = setup({ status: 'failed' });
  assert.equal((await case1.post()).status, 409);
  assert.equal(case1.calls().refreshes, 0);
});

test('an authenticated active post receives a token without caching it', async () => {
  const case1 = setup();
  const response = await case1.post();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).accessToken, 'short-lived-access');
  assert.deepEqual(case1.calls(), { queries: 2, refreshes: 1 });
});
