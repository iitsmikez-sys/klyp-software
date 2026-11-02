import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as core from "../lib/provider-budget-core.ts";
import { ProviderBudget } from "../lib/provider-budget-core.ts";

const nativeRequire = createRequire(import.meta.url);
const source = await readFile(new URL("../lib/analyze-pipeline.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const H = 3600;

/** The real findClips with the Anthropic client, the budget gate and everything else faked. */
function harness({ countTokens } = {}) {
  const seen = { counted: [], created: [], reservations: [] };
  class FakeAnthropic {
    constructor() {
      this.messages = {
        create: (request) => { seen.created.push(request); return { withResponse: async () => ({
          data: { content: [{ type: "text", text: JSON.stringify({ clips: [] }) }], usage: { input_tokens: 1, output_tokens: 1 } },
          response: { headers: new Headers() } }) }; },
      };
      if (countTokens) this.messages.countTokens = async (body, options) => { seen.counted.push({ body, options }); return { input_tokens: await countTokens(body) }; };
    }
  }
  const modules = {
    "@anthropic-ai/sdk": FakeAnthropic,
    "@anthropic-ai/sdk/helpers/zod": { zodOutputFormat: () => ({ type: "json_schema" }) },
    "@/lib/anthropic-rate-limits": { logAnthropicRateLimits: () => {} },
    assemblyai: { AssemblyAI: class {} },
    "@/lib/clips": { DEFAULT_CONTENT_TYPE: "gaming", CLIP_TYPES_BY_CONTENT: { gaming: ["FUNNY"] },
      clipAnalysisSchemaForContentType: () => ({}), clipSchemaForContentType: () => ({ safeParse: (x) => ({ success: true, data: x }) }) },
    "@/lib/bin": { run: async () => {}, runCapture: async () => "10", runYtDlpWithRetry: async () => {}, resolveBin: () => "ffmpeg", FFMPEG_THREADS: 1, ffmpegLocationArgs: () => [], ytDlpThreadCapArgs: () => [] },
    "@/lib/twitch-chat": { twitchVideoId: () => null, detectChatSpikes: async () => null, formatSpikesForPrompt: () => "", spikeWindows: () => [] },
    "@/lib/vision-validation": { validateFinalistVisuals: async (clips) => clips },
    "@/lib/anthropic-credit": { anthropicCreditGate: { assertAvailable: () => {} } },
    "@/lib/provider-cost": { recordProviderUsage: () => {} },
    "@/lib/vod-candidates": { reviewClipBatch: (clips) => ({ ready: clips, flagged: [] }), clipInsideObservedCoverage: () => true },
    "@/lib/clip-boundaries": { reviewClipBatch: (clips) => ({ ready: clips, flagged: [] }) },
    "@/lib/format-transcript": { formatTranscript: () => "" },
    "@/lib/discovery-pool": { discoveryPoolSize: () => 10 },
    "@/lib/analysis-result-cache": { createResultCache: () => null, resultCacheKey: () => "k", selectReviewedCachedClips: () => ({ clips: [], flagged: [], readyCount: 0 }) },
    "@/lib/vod-budget": { reviewProcessingBudget: () => ({ requiresReview: false }) },
    "@/lib/provider-budget": { budgetForRun: () => ({ call: async (stage, microUsd, fn) => { seen.reservations.push([stage, microUsd]); return fn(); } }) },
    "@/lib/provider-budget-core": core,
  };
  const context = { exports: {}, require: (id) => modules[id] ?? nativeRequire(id), process: { env: { ANTHROPIC_API_KEY: "x" } }, console: { log() {}, warn() {}, error() {} }, Buffer, setTimeout, clearTimeout, Headers };
  vm.runInNewContext(code, context, { filename: "analyze-pipeline.ts" });
  const run = (transcript) => context.exports.findClips(transcript, 6 * H, null, 5, "gaming", undefined, [], [], "", "00000000-0000-4000-8000-000000000001");
  return { run, seen };
}

test("the selection call is reserved from the API's token count of the exact request", async () => {
  const h = harness({ countTokens: async () => 1_000 }); // a small request: its counted cost is below the byte bound
  await h.run("hello world");
  assert.equal(h.seen.counted.length, 1);
  const body = h.seen.counted[0].body;
  const sent = h.seen.created[0];
  // The count is taken over the same request that is then sent (system, messages, thinking, schema).
  assert.equal(body.model, "claude-opus-4-8");
  assert.equal(body.system, sent.system);
  assert.deepEqual(body.messages, sent.messages);
  assert.deepEqual(body.thinking, sent.thinking);
  assert.deepEqual(body.output_config, sent.output_config);
  assert.deepEqual(h.seen.reservations, [["select", core.quoteTextMessageFromTokens("claude-opus-4-8", 1_000, 16_000)]]);
  assert.equal(h.seen.counted[0].options.timeout, 20_000);
});

test("if counting fails the call still goes ahead, reserved from the byte-based bound", async () => {
  const h = harness({ countTokens: async () => { throw new Error("rate limited"); } });
  await h.run("hello world");
  assert.equal(h.seen.created.length, 1);
  assert.equal(h.seen.reservations[0][1], core.quoteTextMessage("claude-opus-4-8", JSON.stringify(h.seen.created[0]), 16_000));
});

test("a client without a counting endpoint falls back too (no crash)", async () => {
  const h = harness({});
  await h.run("hello world");
  assert.equal(h.seen.created.length, 1);
  assert.equal(h.seen.reservations[0][0], "select");
});

test("the reservation never exceeds what the old byte-based bound would have reserved", async () => {
  const h = harness({ countTokens: async () => 9_999_999 }); // absurd count
  await h.run("hello world");
  assert.equal(h.seen.reservations[0][1], core.quoteTextMessage("claude-opus-4-8", JSON.stringify(h.seen.created[0]), 16_000));
});

/* ── the point of all this: a real 6-hour analysis fits the unchanged $3 run budget ── */
async function runThroughGate({ hours, transcriptTokensPerHour, counted }) {
  let reserved = 0;
  const budget = new ProviderBudget(async (_stage, micro) => {
    if (reserved + micro > 3_000_000) throw new Error("provider budget exceeded: $3 maximum per analysis run");
    reserved += micro;
  });
  const promptTokens = 10_000; // system prompt and the other sections
  const tokens = promptTokens + hours * transcriptTokensPerHour;
  await budget.call("transcribe", core.quoteTranscription(hours * H), async () => {});
  const q = await core.quoteSelectMessage({ model: "claude-opus-4-8", requestText: "x".repeat(tokens * 4), maxOutputTokens: 16_000,
    countInputTokens: counted ? async () => tokens : undefined });
  await budget.call("select", q.microUsd, async () => {});
  for (let i = 0; i < 2; i++) await budget.call("visual-check", core.quoteVisualMessage("claude-sonnet-4-6", "x".repeat(700), 100, 300_000), async () => {});
  return reserved;
}

test("a typical 6-hour transcript passes all three paid stages inside the $3 budget with exact counting", async () => {
  const reserved = await runThroughGate({ hours: 6, transcriptTokensPerHour: 12_000, counted: true });
  assert.ok(reserved <= 3_000_000, `reserved ${reserved}`);
});

test("...and the same 6-hour run is refused by the budget when reserved from bytes (what used to happen)", async () => {
  await assert.rejects(runThroughGate({ hours: 6, transcriptTokensPerHour: 12_000, counted: false }), /provider budget exceeded/);
});

test("a dense 6-hour transcript (24k tokens/hour) still fits with exact counting", async () => {
  assert.ok(await runThroughGate({ hours: 6, transcriptTokensPerHour: 24_000, counted: true }) <= 3_000_000);
});

test("the budget is still a hard ceiling: an 8-hour dense transcript exceeds it and is refused", async () => {
  await assert.rejects(runThroughGate({ hours: 8, transcriptTokensPerHour: 24_000, counted: true }), /provider budget exceeded/);
});
