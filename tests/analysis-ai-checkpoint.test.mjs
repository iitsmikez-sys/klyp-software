import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createSafeEventSender } from "../lib/analysis-sse.ts";

const nativeRequire = createRequire(import.meta.url);
const source = await readFile(new URL("../app/api/analyze/route.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;

test("saved AI checkpoint bypasses all providers and commits through accounting once", async () => {
  let pipelineCalls = 0;
  let accountingCalls = 0;
  const jobId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const job = { id: jobId, user_id: "user-1", status: "failed", source_key: "twitch:1",
    analysis_clips: [{ start_seconds: 10, end_seconds: 20, title: "Saved moment", words: [] }],
    analysis_duration_seconds: 3600, transcript_chars: 50 };
  const result = { type: "result", clips: job.analysis_clips, durationSeconds: 3600,
    transcriptChars: 50, requestedClips: 3, sparksSpent: 38, sparksBalance: 162 };
  const modules = {
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
    "fs/promises": { mkdtemp: async () => "/fake/job-dir", rm: async () => {} },
    "@anthropic-ai/sdk": class { static AuthenticationError = class {}; static RateLimitError = class {}; },
    "@/lib/clips": { CONTENT_TYPES: ["gaming", "irl"], DEFAULT_CONTENT_TYPE: "gaming" },
    "@/lib/video-cache": { findUploadedVideo: async () => null },
    "@/lib/bin": { resolveBin: () => "ffprobe", runCapture: async () => "3600", runYtDlpCaptureWithIpv6Fallback: async () => "3600" },
    "@/lib/profile-token": { bearerToken: () => "test-token", getProfileFromToken: async () => ({ id: "user-1", sparks: 200 }) },
    "@/lib/cors": { withCors: (response) => response, corsPreflight: () => {} },
    "@/lib/sparks": { estimateSparks: () => 35, MIN_ANALYZE_COST: 10, CLIP_COUNT_OPTIONS: [3], CLIP_COUNT_COST: { 3: 10 }, DEFAULT_CLIP_COUNT: 3 },
    "@/lib/twitch-chat": { detectChatSpikes: async () => null },
    "@/lib/analyze-pipeline": { runAnalysisPipeline: async () => { pipelineCalls++; throw new Error("provider pipeline must not run"); } },
    "@/lib/vod-discovery-pipeline": { runDiscoveryPipeline: async () => { pipelineCalls++; throw new Error("V2 provider pipeline must not run"); } },
    "@/lib/transcripts": { saveTranscript: async () => { throw new Error("ASR must not run"); }, loadJobTranscript: async () => null, findReusableFullTranscript: async () => null },
    "@/lib/analysis-sse": { createSafeEventSender },
    "@/lib/analysis-jobs": { analysisInputHash: () => "hash", createOrLoadAnalysisJob: async () => job,
      findActiveAnalysisJob: async () => null, getAnalysisJob: async () => job, claimAnalysisJob: async () => "run-token",
      checkpointAnalysisJob: async () => {}, failAnalysisJob: async () => {}, accountAnalysisJob: async () => { accountingCalls++; return result; } },
    "@/lib/job-queue": { runQueued: async (_label, run) => run() },
    "@/lib/clip-access": { acquireUserProcessingSlot: () => () => {} },
    "@/lib/analyze-errors": { userFacingAnalysisError: (_stage, _url, message) => message },
    "@/lib/anthropic-credit": { anthropicCreditGate: { blockOn: () => {} } },
    "@/lib/vod-source": { vodSourceKey: () => "twitch:1" },
    "@/lib/analysis-history": { priorClipWindows: async () => [] },
    "@/lib/creator-feedback-data": { preferencesForToken: async () => "" },
  };
  const exports = {};
  const environment = { ...process.env, DEPLOYMENT_TARGET: "processing", ASSEMBLYAI_API_KEY: "fake", ANTHROPIC_API_KEY: "fake" };
  const context = { exports, require: (id) => modules[id] ?? nativeRequire(id), process: { env: environment },
    console, Buffer, TextEncoder, ReadableStream, Response, setInterval, clearInterval, Date };
  vm.runInNewContext(code, context, { filename: "analyze-route.ts" });
  const response = await exports.POST({ json: async () => ({ url: "https://www.twitch.tv/videos/1", jobId, clipCount: 3 }), headers: new Headers() });
  const frames = await response.text();
  assert.match(frames, /Saved moment/);
  assert.equal(pipelineCalls, 0);
  assert.equal(accountingCalls, 1);
});
