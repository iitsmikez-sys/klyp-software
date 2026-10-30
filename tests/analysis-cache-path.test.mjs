import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const nativeRequire = createRequire(import.meta.url);
const source = await readFile(new URL("../lib/analyze-pipeline.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;

function pipelineHarness() {
  const calls = { download: 0, transcription: 0, ai: 0 };
  const provider = class {
    constructor() { calls.transcription++; this.transcripts = { transcribe: async () => ({ status: "completed", words: [{ text: "hello", start: 0, end: 500 }], audio_duration: 10 }) }; }
  };
  const modules = {
    "@anthropic-ai/sdk": class { constructor() { calls.ai++; } },
    "@anthropic-ai/sdk/helpers/zod": { zodOutputFormat: () => ({}) },
    "@/lib/anthropic-rate-limits": { logAnthropicRateLimits: () => {} },
    assemblyai: { AssemblyAI: provider },
    "@/lib/clips": { DEFAULT_CONTENT_TYPE: "gaming", CLIP_TYPES_BY_CONTENT: { gaming: [] } },
    "@/lib/bin": { run: async () => { calls.download++; }, runYtDlpWithRetry: async () => { calls.download++; }, resolveBin: () => "ffmpeg", FFMPEG_THREADS: 1, ffmpegLocationArgs: () => [], ytDlpThreadCapArgs: () => [] },
    "@/lib/twitch-chat": { twitchVideoId: () => null, detectChatSpikes: async () => null },
    "@/lib/vision-validation": { validateFinalistVisuals: async (clips) => clips },
    "@/lib/anthropic-credit": { anthropicCreditGate: { assertAvailable: () => {} } },
    "@/lib/provider-cost": { recordProviderUsage: () => {} },
    "@/lib/vod-candidates": { reviewClipBatch: (clips) => ({ ready: clips, flagged: [] }) },
    "@/lib/clip-boundaries": { reviewClipBatch: (clips) => ({ ready: clips, flagged: [] }) },
    "@/lib/format-transcript": { formatTranscript: (words) => words.map((word) => word.text).join(" ") },
  };
  const context = { exports: {}, require: (id) => modules[id] ?? nativeRequire(id), process, console, Buffer, setTimeout, clearTimeout };
  vm.runInNewContext(code, context, { filename: "analyze-pipeline.ts" });
  return { run: context.exports.runAnalysisPipeline, calls };
}

test("completed transcript bypasses download and paid transcription", async () => {
  const { run, calls } = pipelineHarness();
  const stop = new Error("stop before AI");
  await assert.rejects(run({ uploadedPath: null, url: "https://example.test/vod", clipCount: 3,
    workDir: "/unused", cachedTranscript: { words: [{ text: "hello", start: 0, end: 500 }], durationSeconds: 10, coverageMode: "full" },
    onProgress(stage, status) { if (stage === "analyze" && status === "running") throw stop; },
  }), (err) => err === stop);
  assert.deepEqual(calls, { download: 0, transcription: 0, ai: 0 });
});

test("fresh transcription checkpoint runs before AI analysis", async () => {
  const { run, calls } = pipelineHarness();
  const stop = new Error("checkpointed");
  let checkpoint = null;
  await assert.rejects(run({ uploadedPath: "/fake/local.mp4", url: "", clipCount: 3,
    workDir: "/unused", onTranscript: async (value) => { checkpoint = value; throw stop; },
  }), (err) => err === stop);
  assert.equal(calls.download, 1);
  assert.equal(calls.transcription, 1);
  assert.equal(calls.ai, 0);
  assert.equal(checkpoint.words[0].text, "hello");
});
