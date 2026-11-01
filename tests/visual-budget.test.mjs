import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';

const source = await readFile(new URL('../lib/vision-validation.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const nativeRequire = createRequire(import.meta.url);

test('visual AI is not called when its reservation is denied', async () => {
  let providerCalls = 0;
  class AnthropicMock {
    messages = { create: async () => { providerCalls++; return { usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: 'text', text: '{"adjustment":0}' }] }; } };
  }
  const scalar = { int: () => scalar, min: () => scalar, max: () => scalar };
  const modules = {
    'node:fs/promises': { readFile: async () => Buffer.alloc(100) },
    '@anthropic-ai/sdk': AnthropicMock,
    '@anthropic-ai/sdk/helpers/zod': { zodOutputFormat: () => ({}) },
    zod: { z: { object: () => ({ parse: value => value }), number: () => scalar } },
    '@/lib/bin': { resolveBin: () => 'ffmpeg', run: async () => {} },
    '@/lib/video-cache': { resolveSourceSegment: async () => ({ path: '/fake', offsetSeconds: 0 }) },
    '@/lib/vision-plan': { planVisualChecks: clips => [{ clip: clips[0], index: 0, frameSecond: 10 }],
      applyVisualCheck: clip => clip },
    '@/lib/provider-cost': { recordProviderUsage: () => {} },
    '@/lib/provider-budget': { budgetForRun: () => ({ call: async () => { throw new Error('provider budget exceeded'); } }) },
    '@/lib/provider-budget-core': { quoteVisualMessage: () => 300_000 },
  };
  const context = { exports: {}, require: id => modules[id] ?? nativeRequire(id),
    process: { env: { ANTHROPIC_API_KEY: 'mock-only' } }, console, Buffer };
  vm.runInNewContext(code, context, { filename: 'vision-validation.ts' });
  await assert.rejects(context.exports.validateFinalistVisuals([{ start_seconds: 0, end_seconds: 20,
    viral_score: 80, reason: 'reaction' }], '/fake', '/tmp', true,
  '11111111-1111-4111-8111-111111111111'), /provider budget exceeded/);
  assert.equal(providerCalls, 0);
});
