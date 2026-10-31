import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { discoveryPoolSize, fullVodCoverage } from '../lib/discovery-pool.ts';
import { clipCharge, estimateSparks } from '../lib/sparks.ts';

const require = createRequire(import.meta.url);
const source = await readFile(new URL('../lib/analyze-pipeline.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
} }).outputText;

function harness() {
  const saved = new Map();
  const calls = { selection: 0, prompts: [], visualPools: [] };
  const moments = [100, 200, 300, 400, 500, 600].map((start_seconds, index) => ({
    start_seconds, end_seconds: start_seconds + 30, thumbnail_seconds: start_seconds + 15,
    viral_score: 95 - index * 4, title: `Moment ${index}`, type: 'FUNNY',
  }));
  const weak = { ...moments[5], start_seconds: 700, end_seconds: 730, viral_score: 61 };
  class AnthropicMock {
    messages = { create: (_input) => ({ withResponse: async () => {
      calls.selection++;
      calls.prompts.push(_input);
      return { data: { content: [{ type: 'text', text: JSON.stringify({ clips: [weak, ...moments].reverse() }) }],
        usage: { input_tokens: 100, output_tokens: 100 } }, response: { headers: new Headers() } };
    } }) };
  }
  const modules = {
    '@anthropic-ai/sdk': AnthropicMock,
    '@anthropic-ai/sdk/helpers/zod': { zodOutputFormat: () => ({}) },
    '@/lib/anthropic-rate-limits': { logAnthropicRateLimits: () => {} },
    assemblyai: { AssemblyAI: class {} },
    '@/lib/clips': { DEFAULT_CONTENT_TYPE: 'gaming', CLIP_TYPES_BY_CONTENT: { gaming: ['FUNNY'] },
      clipSchemaForContentType: () => ({ safeParse: clip => ({ success: true, data: clip }) }),
      clipAnalysisSchemaForContentType: () => ({}) },
    '@/lib/bin': { run: async () => {}, runYtDlpWithRetry: async () => {}, resolveBin: () => 'ffmpeg',
      FFMPEG_THREADS: 1, ffmpegLocationArgs: () => [], ytDlpThreadCapArgs: () => [] },
    '@/lib/twitch-chat': { twitchVideoId: () => '123', detectChatSpikes: async () => null },
    '@/lib/vision-validation': { validateFinalistVisuals: async clips => {
      calls.visualPools.push(clips.length);
      return clips;
    } },
    '@/lib/anthropic-credit': { anthropicCreditGate: { assertAvailable: () => {} } },
    '@/lib/provider-cost': { recordProviderUsage: () => {} },
    '@/lib/vod-candidates': { clipInsideObservedCoverage: () => true },
    '@/lib/clip-boundaries': { reviewClipBatch: clips => ({ ready: clips, flagged: [] }) },
    '@/lib/format-transcript': { formatTranscript: () => 'Full VOD transcript: quiet joke at 600 seconds.' },
    '@/lib/discovery-pool': { discoveryPoolSize },
    '@/lib/vod-budget': { reviewProcessingBudget: () => ({ requiresReview: false }) },
    '@/lib/analysis-result-cache': {
      resultCacheKey: input => JSON.stringify(input),
      availableCachedClips: (clips, prior, count) => clips.filter(c =>
        !prior.some(p => Math.abs(p.start_seconds - c.start_seconds) < 60)).slice(0, count),
      selectReviewedCachedClips: (clips, _words, _duration, prior, count) => {
        const ready = clips.filter(c => !prior.some(p => Math.abs(p.start_seconds - c.start_seconds) < 60));
        return { clips: ready.slice(0, count), readyCount: clips.length, flagged: [] };
      },
      createResultCache: (_client, _user, _source, _duration, key) => ({
        load: async () => saved.get(key) ?? null, save: async clips => { saved.set(key, clips); },
      }),
    },
  };
  const context = { exports: {}, require: id => modules[id] ?? require(id), process, console,
    Buffer, setTimeout, clearTimeout, Headers };
  vm.runInNewContext(code, context, { filename: 'analyze-pipeline.ts' });
  const run = count => context.exports.runAnalysisPipeline({ uploadedPath: null,
    url: 'https://www.twitch.tv/videos/123', durationHint: 1000, clipCount: count,
    workDir: '/unused', sourceKey: 'twitch:123', userId: 'test-user', client: {},
    cachedTranscript: { words: [{ text: 'joke', start: 600000, end: 600500 }],
      durationSeconds: 1000, coverageMode: 'full' },
  });
  return { run, calls };
}

test('requests of 1, 2, 3, 5, and 10 use the same complete discovery pool', async () => {
  const { run, calls } = harness();
  for (const [count, expected] of [[1, 1], [2, 2], [3, 3], [5, 5], [10, 6]]) {
    const result = await run(count);
    assert.equal(result.clips.length, expected);
    assert.deepEqual(Array.from(result.clips, c => c.start_seconds), [100, 200, 300, 400, 500, 600].slice(0, expected));
  }
  assert.equal(calls.selection, 1, 'repeat requests must reuse the judged pool');
  assert.deepEqual(calls.visualPools, [6], 'all strong candidates are visually ranked once before delivery is limited');
  assert.match(calls.prompts[0].system, /top 10/i);
  assert.ok(calls.prompts[0].messages[0].content.includes('quiet joke'));
});

test('analysis charge stays while clip charge follows successfully returned count', () => {
  assert.equal(estimateSparks(3600) + clipCharge(10, 6), 59);
  assert.equal(estimateSparks(3600) + clipCharge(10, 0), 35);
});

test('full VOD coverage leaves no quiet interval or hour-boundary gap', () => {
  assert.deepEqual(fullVodCoverage(6 * 3600), [{ start: 0, end: 6 * 3600 }]);
  assert.equal(discoveryPoolSize(1), discoveryPoolSize(10));
  assert.throws(() => fullVodCoverage(0), /Invalid VOD duration/);
});
