import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../lib/vod-poll.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;

test('automatic clipping skips an 11-hour VOD without paid work or a Sparks debit', async () => {
  const job = { id: 'job-1', user_id: 'user-1', stream_id: 'stream-1', video_id: '123',
    url: 'https://www.twitch.tv/videos/123', duration_seconds: 39600, attempts: 1 };
  let paidPipelineCalls = 0;
  let completion = null;
  const notifications = [];
  const pending = { select() { return this; }, lte() { return this; }, lt() { return this; },
    async limit() { return { data: [], error: null }; } };
  const admin = {
    async rpc(name, args) {
      if (name === 'claim_auto_vod_job') return { data: [job], error: null };
      if (name === 'admin_get_profile') return { data: { id: job.user_id, sparks: 500 }, error: null };
      if (name === 'finish_auto_vod_job') { completion = args; return { data: true, error: null }; }
      if (name === 'fail_auto_vod_job' || name === 'fail_auto_vod_job_limited') return { data: 'failed', error: null };
      throw new Error(`Unexpected RPC: ${name}`);
    },
    from(table) {
      if (table === 'pending_vod_checks') return pending;
      if (table === 'notifications') return { insert: async row => {
        notifications.push(row); return { error: null };
      } };
      throw new Error(`Unexpected table: ${table}`);
    },
  };
  const modules = {
    'fs/promises': { mkdtemp: async () => 'fixture-dir', rm: async () => {} },
    os: { tmpdir: () => 'fixture-tmp' }, path: { join: (...parts) => parts.join('/') },
    '@/lib/supabase/admin': { createAdminClient: () => admin },
    '@/lib/twitch': { getRecentVods: async () => [], parseTwitchDuration: () => 0 },
    '@/lib/vod-discovery': { unseenVods: () => [] },
    '@/lib/analyze-pipeline': { runAnalysisPipeline: async () => {
      paidPipelineCalls++; return { clips: [], durationSeconds: job.duration_seconds };
    } },
    '@/lib/vod-discovery-pipeline': { runDiscoveryPipeline: async () => { paidPipelineCalls++; throw new Error('unexpected v2'); } },
    '@/lib/vod-source': { vodSourceKey: () => 'twitch:123' },
    '@/lib/anthropic-credit': { anthropicCreditGate: { blockOn() {} },
      isAnthropicCreditBalanceError: () => false, pauseAutomaticClipping: async () => {} },
    '@/lib/creator-feedback-data': { preferencesForUser: async () => '' },
    '@/lib/clip-archive-worker': { processClipArchiveJobs: async () => {} },
    '@/lib/r2-maintenance': { processR2Maintenance: async () => {} },
    '@/lib/job-queue': { runQueued: (_label, fn) => fn() },
    '@/lib/sparks': { estimateSparks: () => 50, clipCharge: () => 0,
      CLIP_COUNT_COST: { 5: 20 }, DEFAULT_CLIP_COUNT: 5 },
  };
  const exports = {};
  vm.runInNewContext(code, { exports, require: name => {
    if (!(name in modules)) throw new Error(`Unexpected import: ${name}`);
    return modules[name];
  }, process: { env: {} }, console: { log() {}, warn() {}, error() {} },
  setInterval() {}, setTimeout, Date, Error, Math, Number, String, Promise });
  exports.startAutoClipWorker();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(paidPipelineCalls, 0);
  assert.equal(completion?.p_cost, 0);
  assert.equal(completion?.p_clips?.length, 0);
  assert.match(notifications[0]?.message ?? '', /10 hours/);
});
