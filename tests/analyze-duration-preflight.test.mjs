import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as planLimits from '../lib/plan-limits.ts';

const source = readFileSync(new URL('../app/api/analyze/route.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;

function routeHarness({ duration = '7200', sparks = 20 } = {}) {
  let paidPipelineCalls = 0;
  const response = class extends Response {
    static json(value, init) { return new this(JSON.stringify(value), init); }
  };
  const modules = {
    'next/server': { NextResponse: response },
    'fs/promises': { mkdtemp: async () => 'fixture-dir', rm: async () => {} },
    'node:crypto': { randomUUID: () => '00000000-0000-4000-8000-000000000001' },
    os: { tmpdir: () => 'fixture-tmp' },
    path: { default: { join: (...parts) => parts.join('/') }, join: (...parts) => parts.join('/') },
    '@anthropic-ai/sdk': { default: class Anthropic {} },
    '@/lib/language-hint': { isMostlyEnglish: () => true, languageSection: () => '' },
    '@/lib/loud-moments': { detectLoudMoments: async () => [], formatLoudMomentsForPrompt: () => '', isQuietStream: () => false },
    '@/lib/clips': { CONTENT_TYPES: ['gaming', 'irl'], DEFAULT_CONTENT_TYPE: 'gaming' },
    '@/lib/video-cache': { findUploadedVideo: async () => null },
    '@/lib/profile-token': { bearerToken: () => 'fixture-token',
      getProfileFromToken: async () => ({ id: 'fixture-user', sparks, tier: 'pro', stripe_subscription_id: 'sub_test' }), tokenClient: () => ({}) },
    '@/lib/plan-limits': planLimits,
    '@/lib/cors': { withCors: value => value, corsPreflight: () => {} },
    '@/lib/sparks': { estimateSparks: seconds => seconds < 1800 ? 10 : seconds < 3600 ? 20 : seconds < 7200 ? 35 : 50,
      MIN_ANALYZE_COST: 20, CLIP_COUNT_OPTIONS: [3], CLIP_COUNT_COST: { 3: 10 }, DEFAULT_CLIP_COUNT: 3, clipCountForDuration: () => 3 },
    '@/lib/twitch-chat': { detectChatSpikes: async () => null },
    '@/lib/analyze-pipeline': { runAnalysisPipeline: async () => { paidPipelineCalls++; return {
      clips: [], skipped: 0, durationSeconds: 7200, transcriptChars: 0, words: [] }; } },
    '@/lib/vod-discovery-pipeline': { runDiscoveryPipeline: async () => { paidPipelineCalls++; throw new Error('unexpected v2'); } },
    '@/lib/transcripts': { saveTranscript: async () => {} },
    '@/lib/analysis-sse': { createSafeEventSender: () => ({ send: () => {}, ping: () => true, close: () => {} }) },
    '@/lib/analysis-jobs': { createOrLoadAnalysisJob: async () => ({ id: 'fixture-job', status: 'queued' }),
      isAnalysisJobStale: () => false, getAnalysisJob: async () => null, claimAnalysisJob: async () => 'run',
      checkpointAnalysisJob: async () => {}, failAnalysisJob: async () => {}, accountAnalysisJob: async () => ({ type: 'result', clips: [] }) },
    '@/lib/job-queue': { runQueued: (_label, fn) => fn() },
    '@/lib/clip-access': { acquireUserProcessingSlot: () => () => {} },
    '@/lib/analysis-limits': { MAX_ANALYSES_PER_HOUR: 10, startedAnalysesLastHour: async () => 0 },
    '@/lib/free-capacity': { checkFreeCapacity: async () => ({ ok: true }), recordPlanAtStart: async () => {} },
    '@/lib/analyze-errors': { userFacingAnalysisError: (_stage, _url, message) => message },
    '@/lib/anthropic-credit': { anthropicCreditGate: { blockOn: () => {} } },
    '@/lib/vod-source': { vodSourceKey: () => 'twitch:123' },
    '@/lib/analysis-history': { priorClipWindows: async () => [], recordAndChargeClips: async () => ({
      clips: [], sparksSpent: 0, sparksBalance: sparks }) },
    '@/lib/creator-feedback-data': { preferencesForToken: async () => '' },
    '@/lib/bin': { runYtDlpCaptureWithIpv6Fallback: async () => duration,
      runCapture: async () => duration, resolveBin: () => 'ffprobe' },
  };
  const exports = {};
  vm.runInNewContext(code, { exports, require: name => {
    if (!(name in modules)) throw new Error(`Unexpected import: ${name}`);
    return modules[name];
  }, process: { env: { DEPLOYMENT_TARGET: 'processing', ASSEMBLYAI_API_KEY: 'fixture',
    ANTHROPIC_API_KEY: 'fixture' } }, Response, TextEncoder, ReadableStream, setInterval,
    clearInterval, console, Math, Number, String, Date, Error });
  return { post: () => exports.POST({ json: async () => ({
    url: 'https://www.twitch.tv/videos/123', durationHint: 600, clipCount: 3 }),
  }), get paidPipelineCalls() { return paidPipelineCalls; } };
}

test('understated browser duration cannot start paid analysis with an insufficient Sparks balance', async () => {
  const harness = routeHarness({ duration: '7200', sparks: 20 });
  const result = await harness.post();
  assert.equal(result.status, 402);
  assert.equal(harness.paidPipelineCalls, 0);
});

test('a VOD beyond the Pro 8-hour limit is rejected before paid processing', async () => {
  const harness = routeHarness({ duration: '36001', sparks: 500 });
  const result = await harness.post();
  assert.equal(result.status, 413);
  assert.match((await result.json()).error, /8 hours/);
  assert.equal(harness.paidPipelineCalls, 0);
});
