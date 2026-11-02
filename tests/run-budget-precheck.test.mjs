import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import {
  RUN_PROVIDER_LIMIT_MICRO_USD,
  maxFullPassSeconds,
  reservedMicroUsdForPass,
  reviewProcessingBudget,
} from "../lib/vod-budget.ts";
import { quoteTextMessage, quoteTranscription, quoteVisualMessage } from "../lib/provider-budget-core.ts";

const H = 3600;

test("the early check's limit equals the database gate's limit (migration 036)", async () => {
  const sql = await readFile(new URL("../supabase/migrations/036_analysis_provider_budget.sql", import.meta.url), "utf8");
  const limits = [...sql.matchAll(/3000000/g)];
  assert.ok(limits.length >= 2, "migration 036 should state the $3 limit");
  assert.equal(RUN_PROVIDER_LIMIT_MICRO_USD, 3_000_000);
});

test("reservation grows with length, and 1h and 2h videos fit while 3h and 10h do not", () => {
  let prev = 0;
  for (const h of [0.25, 0.5, 1, 1.5, 2, 2.5, 3, 5, 10]) {
    const reserved = reservedMicroUsdForPass(h * H);
    assert.ok(reserved > prev, `${h}h should reserve more than the previous length`);
    prev = reserved;
  }
  assert.ok(reservedMicroUsdForPass(1 * H) <= RUN_PROVIDER_LIMIT_MICRO_USD);
  assert.ok(reservedMicroUsdForPass(2 * H) <= RUN_PROVIDER_LIMIT_MICRO_USD, "the advertised 2-hour tier must stay supported");
  assert.ok(reservedMicroUsdForPass(3 * H) > RUN_PROVIDER_LIMIT_MICRO_USD);
  assert.ok(reservedMicroUsdForPass(10 * H) > RUN_PROVIDER_LIMIT_MICRO_USD);
});

test("the cutoff is between 2 and 3 hours and the boundary behaves", () => {
  const max = maxFullPassSeconds();
  assert.ok(max >= 2 * H && max < 3 * H, `cutoff was ${(max / H).toFixed(2)}h`);
  assert.ok(reservedMicroUsdForPass(max) <= RUN_PROVIDER_LIMIT_MICRO_USD);
  assert.ok(reservedMicroUsdForPass(max + 120) > RUN_PROVIDER_LIMIT_MICRO_USD);
});

test("cross-check: the three real gate reservations for a worst-case transcript stay within $3 exactly when the early check says so", () => {
  // Independent of vod-budget's own arithmetic: replay the stages the way the pipeline reserves them.
  const replay = (seconds) => {
    const hours = seconds / H;
    const transcriptBytes = 30_000 + Math.ceil(hours * 70_000);
    return quoteTranscription(seconds)
      + quoteTextMessage("claude-opus-4-8", "x".repeat(transcriptBytes), 16000)
      + 2 * quoteVisualMessage("claude-sonnet-4-6", "x".repeat(700), 100, 300_000);
  };
  for (const h of [0.5, 1, 2, 2.2, 2.3, 2.6, 4, 8]) {
    const fits = replay(h * H) <= RUN_PROVIDER_LIMIT_MICRO_USD;
    assert.equal(reviewProcessingBudget([{ start: 0, end: h * H }], 100).exceedsRunLimit, !fits, `${h}h`);
  }
});

test("a video the gate cannot price is refused, not waved through", () => {
  assert.equal(reservedMicroUsdForPass(11 * H), null); // beyond what transcription can be bounded for
  assert.equal(reviewProcessingBudget([{ start: 0, end: 11 * H }], 100).requiresReview, true);
});

test("review flags too-long audio with the longest allowed length, and leaves normal runs alone", () => {
  const long = reviewProcessingBudget([{ start: 0, end: 5 * H }], 100);
  assert.equal(long.requiresReview, true);
  assert.equal(long.exceedsRunLimit, true);
  assert.ok(long.maxRunHours >= 2 && long.maxRunHours < 3);
  const normal = reviewProcessingBudget([{ start: 0, end: 1 * H }], 5);
  assert.equal(normal.requiresReview, false);
  assert.equal(normal.exceedsRunLimit, false);
});

test("an empty plan (nothing to transcribe) is never flagged", () => {
  const empty = reviewProcessingBudget([], 5);
  assert.equal(empty.requiresReview, false);
  assert.equal(empty.exceedsRunLimit, false);
});

test("short windows (e.g. chat-sampled Twitch audio) are checked on the audio actually transcribed", () => {
  // 20 one-minute windows = 20 minutes of audio, however long the VOD is.
  const windows = Array.from({ length: 20 }, (_, i) => ({ start: i * 1800, end: i * 1800 + 60 }));
  assert.equal(reviewProcessingBudget(windows, 5).exceedsRunLimit, false);
});

test("KLYP_RUN_BUDGET_PRECHECK=off restores the old behavior (rollback switch)", () => {
  process.env.KLYP_RUN_BUDGET_PRECHECK = "off";
  try {
    const r = reviewProcessingBudget([{ start: 0, end: 4 * H }], 100);
    assert.equal(r.exceedsRunLimit, true); // still reported...
    assert.equal(r.requiresReview, false); // ...but no longer blocks
  } finally {
    delete process.env.KLYP_RUN_BUDGET_PRECHECK;
  }
});

test("the existing $ ceiling still pauses runs on its own", () => {
  assert.equal(reviewProcessingBudget([{ start: 0, end: 600 }], 0.01).requiresReview, true);
});

/* ── the real pipeline refuses BEFORE any download or paid call ── */
const nativeRequire = createRequire(import.meta.url);
const source = await readFile(new URL("../lib/analyze-pipeline.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;

function pipelineHarness(review) {
  const calls = { download: 0, transcription: 0, ai: 0, probe: 0 };
  const modules = {
    "@anthropic-ai/sdk": class { constructor() { calls.ai++; } },
    "@anthropic-ai/sdk/helpers/zod": { zodOutputFormat: () => ({}) },
    "@/lib/anthropic-rate-limits": { logAnthropicRateLimits: () => {} },
    assemblyai: { AssemblyAI: class { constructor() { calls.transcription++; } } },
    "@/lib/clips": { DEFAULT_CONTENT_TYPE: "gaming", CLIP_TYPES_BY_CONTENT: { gaming: [] } },
    "@/lib/bin": { run: async () => { calls.download++; }, runCapture: async () => { calls.probe++; return "10"; },
      runYtDlpWithRetry: async () => { calls.download++; }, resolveBin: () => "ffmpeg", FFMPEG_THREADS: 1,
      ffmpegLocationArgs: () => [], ytDlpThreadCapArgs: () => [] },
    "@/lib/twitch-chat": { twitchVideoId: () => null, detectChatSpikes: async () => null },
    "@/lib/vision-validation": { validateFinalistVisuals: async (clips) => clips },
    "@/lib/anthropic-credit": { anthropicCreditGate: { assertAvailable: () => {} } },
    "@/lib/provider-cost": { recordProviderUsage: () => {} },
    "@/lib/vod-candidates": { reviewClipBatch: (clips) => ({ ready: clips, flagged: [] }) },
    "@/lib/clip-boundaries": { reviewClipBatch: (clips) => ({ ready: clips, flagged: [] }) },
    "@/lib/format-transcript": { formatTranscript: () => "" },
    "@/lib/discovery-pool": { discoveryPoolSize: () => 10 },
    "@/lib/analysis-result-cache": { createResultCache: () => null, resultCacheKey: () => "cache", selectReviewedCachedClips: () => ({ clips: [], flagged: [], readyCount: 0 }) },
    "@/lib/vod-budget": { reviewProcessingBudget: () => review },
    "@/lib/provider-budget": { budgetForRun: () => ({ call: async (_s, _a, fn) => fn() }) },
    "@/lib/provider-budget-core": { quoteTranscription: () => 1, quoteTextMessage: () => 1 },
  };
  const context = { exports: {}, require: (id) => modules[id] ?? nativeRequire(id), process, console, Buffer, setTimeout, clearTimeout };
  vm.runInNewContext(code, context, { filename: "analyze-pipeline.ts" });
  return { run: context.exports.runAnalysisPipeline, calls };
}

test("pipeline: a too-long full-transcript video is refused with a clear message and ZERO paid or download work", async () => {
  const { run, calls } = pipelineHarness({ requiresReview: true, exceedsRunLimit: true, maxRunHours: 2.3, projectedUsd: 9, audioSeconds: 18_000 });
  await assert.rejects(
    run({ uploadedPath: "/fake/long.mp4", url: "", durationHint: 5 * H, clipCount: 3, workDir: "/unused" }),
    (err) => /too long to analyze in one pass/.test(err.message) && /2\.3 hours/.test(err.message) && /No Sparks were charged/.test(err.message)
  );
  assert.deepEqual(calls, { download: 0, transcription: 0, ai: 0, probe: 0 });
});

test("pipeline: the dollar-ceiling pause keeps its own message", async () => {
  const { run, calls } = pipelineHarness({ requiresReview: true, exceedsRunLimit: false, projectedUsd: 9.5, audioSeconds: 18_000 });
  await assert.rejects(
    run({ uploadedPath: "/fake/long.mp4", url: "", durationHint: 5 * H, clipCount: 3, workDir: "/unused" }),
    (err) => /estimated \$9\.50 processing budget/.test(err.message)
  );
  assert.equal(calls.download + calls.transcription + calls.ai, 0);
});
