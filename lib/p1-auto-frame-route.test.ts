import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { z } from 'zod';
import { parseFrameSuggestion, readBoundedFrameBody, validateFrameSamples } from './auto-frame.ts';

const code = ts.transpileModule(readFileSync(new URL('../app/api/clips/[id]/auto-frame/route.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const jpg = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0xff, 0xd9]).toString('base64');
async function request(options: { token?: boolean; tier?: string; owned?: boolean; frames?: unknown; ai?: unknown; twice?: boolean } = {}) {
  let calls = 0;
  class NextResponse extends Response { static json(value: unknown, init?: ResponseInit) { return new NextResponse(JSON.stringify(value), init); } }
  const db: any = { select: () => db, eq: () => db, maybeSingle: async () => ({ data: options.owned === false ? null : { id: 'clip' }, error: null }) };
  const modules: Record<string, unknown> = {
    'next/server': { NextResponse }, '@anthropic-ai/sdk': { __esModule: true, default: class { messages = { create: async () => { calls++; return { content: [{ type: 'text', text: JSON.stringify(options.ai ?? { confidence: .9, gameplay: { x: .3, y: 0, w: .35, h: 1 }, facecam: null }) }] }; } }; } },
    '@anthropic-ai/sdk/helpers/zod': { zodOutputFormat: () => ({}) }, zod: { z },
    '@/lib/supabase/admin': { createAdminClient: () => ({ from: () => db }) },
    '@/lib/profile-token': { bearerToken: () => options.token === false ? null : 'token', getProfileFromToken: async () => ({ id: 'user', tier: options.tier ?? 'pro', stripe_subscription_id: options.tier === 'unconfirmed' ? null : 'sub' }) },
    '@/lib/clip-access': { acquireUserProcessingSlot: () => () => {} },
    '@/lib/auto-frame': { parseFrameSuggestion, readBoundedFrameBody, validateFrameSamples },
    '@/lib/cors': { withCors: (value: Response) => value, corsPreflight: () => {} },
  };
  const exports: any = {};
  vm.runInNewContext(code, { exports, require: (name: string) => { if (!(name in modules)) throw new Error(name); return modules[name]; }, process: { env: { DEPLOYMENT_TARGET: 'processing', ANTHROPIC_API_KEY: 'fixture' } }, globalThis: {}, Buffer, Response, Date, JSON, Map });
  const body = new Request('https://fixture.test', { method: 'POST', body: JSON.stringify({ frames: options.frames ?? [jpg] }) });
  const response: Response = await exports.POST(body, { params: Promise.resolve({ id: 'clip' }) });
  const repeated: Response | null = options.twice ? await exports.POST(new Request('https://fixture.test', { method: 'POST', body: JSON.stringify({ frames: [jpg] }) }), { params: Promise.resolve({ id: 'clip' }) }) : null;
  return { response, repeated, calls };
}
test('requires sign-in, Pro, and clip ownership before model call', async () => {
  for (const options of [{ token: false }, { tier: 'free' }, { tier: 'unconfirmed' }, { owned: false }]) {
    const result = await request(options);
    assert.ok([401, 403, 404].includes(result.response.status));
    assert.equal(result.calls, 0);
  }
});
test('rejects oversized and non-JPEG payloads before model call', async () => {
  for (const frames of [[jpg, jpg, jpg, jpg], ['not jpeg']]) {
    const result = await request({ frames });
    assert.equal(result.response.status, 400);
    assert.equal(result.calls, 0);
  }
});
test('returns a reviewable suggestion or null without changing a saved draft', async () => {
  const success = await request();
  assert.equal(success.response.status, 200);
  assert.equal((await success.response.json()).layout.gameplay.x, .3);
  const uncertain = await request({ ai: { confidence: .2, gameplay: { x: .3, y: 0, w: .35, h: 1 }, facecam: null } });
  assert.equal((await uncertain.response.json()).layout, null);
  const limited = await request({ twice: true });
  assert.equal(limited.repeated?.status, 429);
  assert.equal(limited.calls, 1);
});
