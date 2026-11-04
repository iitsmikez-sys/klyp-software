import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as planLimits from "../lib/plan-limits.ts";

const transpile = (path) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const routeCode = transpile("../app/api/analyze/route.ts");
const slotCode = transpile("../lib/clip-access-core.ts");
const limitsCode = transpile("../lib/analysis-limits.ts");

/** Each call gets its own global, so in-memory slot counters never leak between tests. */
function loadSlots() {
  const exports = {};
  vm.runInNewContext(slotCode, { exports, require: () => ({}), Map, Math }, { filename: "clip-access-core.ts" });
  return exports;
}

/* ── the slot helper ── */
test("scoped analysis slot: one at a time per account, released slots can be taken again", () => {
  const { acquireUserProcessingSlot: acquire } = loadSlots();
  const first = acquire("u1", { scope: "analysis", max: 1 });
  assert.equal(typeof first, "function");
  assert.equal(acquire("u1", { scope: "analysis", max: 1 }), null);
  first();
  const again = acquire("u1", { scope: "analysis", max: 1 });
  assert.equal(typeof again, "function");
  again();
});

test("a slot released twice does not free a second slot", () => {
  const { acquireUserProcessingSlot: acquire } = loadSlots();
  const a = acquire("u1", { scope: "analysis", max: 1 });
  a(); a();
  const b = acquire("u1", { scope: "analysis", max: 1 });
  assert.equal(acquire("u1", { scope: "analysis", max: 1 }), null);
  b();
});

test("other accounts are unaffected", () => {
  const { acquireUserProcessingSlot: acquire } = loadSlots();
  const a = acquire("u1", { scope: "analysis", max: 1 });
  const b = acquire("u2", { scope: "analysis", max: 1 });
  assert.equal(typeof b, "function");
  a(); b();
});

test("the shared per-account budget is unchanged (3) and independent of the analysis scope", () => {
  const { acquireUserProcessingSlot: acquire } = loadSlots();
  const shared = [acquire("u1"), acquire("u1"), acquire("u1")];
  assert.ok(shared.every((s) => typeof s === "function"));
  assert.equal(acquire("u1"), null, "a 4th shared slot is refused");
  const analysis = acquire("u1", { scope: "analysis", max: 1 });
  assert.equal(typeof analysis, "function", "the analysis scope has its own counter");
  analysis(); shared.forEach((s) => s());
});

/* ── the hourly count ── */
function limitsHarness({ count = 0, error = null } = {}) {
  const calls = [];
  const chain = {
    select(...args) { calls.push(["select", ...args]); return chain; },
    eq(...args) { calls.push(["eq", ...args]); return chain; },
    gt(...args) { calls.push(["gt", ...args]); return chain; },
    gte(...args) { calls.push(["gte", ...args]); return Promise.resolve({ count, error }); },
  };
  const exports = {};
  vm.runInNewContext(limitsCode, { exports, process: { env: {} }, Number, Date,
    require: () => ({ createAdminClient: () => ({ from: (table) => { calls.push(["from", table]); return chain; } }) }) });
  return { ...exports, calls };
}

test("hourly count only counts analyses that actually started, in the last hour, for that user", async () => {
  const h = limitsHarness({ count: 4 });
  const now = Date.parse("2026-11-02T12:00:00Z");
  assert.equal(await h.startedAnalysesLastHour("user-1", now), 4);
  assert.deepEqual(h.calls.find((c) => c[0] === "from"), ["from", "analysis_jobs"]);
  assert.deepEqual(h.calls.find((c) => c[0] === "eq"), ["eq", "user_id", "user-1"]);
  assert.deepEqual(h.calls.find((c) => c[0] === "gt"), ["gt", "attempts", 0]);
  assert.deepEqual(h.calls.find((c) => c[0] === "gte"), ["gte", "created_at", "2026-11-02T11:00:00.000Z"]);
});

test("hourly count surfaces database errors to the caller", async () => {
  const h = limitsHarness({ error: { message: "db down" } });
  await assert.rejects(h.startedAnalysesLastHour("u"), /db down/);
});

test("default cap is 10 an hour", () => {
  assert.equal(limitsHarness().MAX_ANALYSES_PER_HOUR, 10);
});

/* ── the real route, with the real slot helper ── */
function routeHarness({ startedLastHour = 0, countFails = false, jobStatus = "queued", pipeline } = {}) {
  const state = { claims: 0, pipelineRuns: 0, acquisitions: 0 };
  const slots = loadSlots();
  const countingAcquire = (...args) => { state.acquisitions++; return slots.acquireUserProcessingSlot(...args); };
  const response = class extends Response { static json(value, init) { return new this(JSON.stringify(value), init); } };
  const modules = {
    "next/server": { NextResponse: response },
    "fs/promises": { mkdtemp: async () => "fixture-dir", rm: async () => {} },
    "node:crypto": { randomUUID: () => "00000000-0000-4000-8000-000000000001" },
    os: { tmpdir: () => "fixture-tmp" },
    path: { default: { join: (...p) => p.join("/") }, join: (...p) => p.join("/") },
    "@anthropic-ai/sdk": { default: class Anthropic {} },
    "@/lib/loud-moments": { detectLoudMoments: async () => [], formatLoudMomentsForPrompt: () => '', isQuietStream: () => false },
    "@/lib/clips": { CONTENT_TYPES: ["gaming", "irl"], DEFAULT_CONTENT_TYPE: "gaming" },
    "@/lib/video-cache": { findUploadedVideo: async () => null },
    "@/lib/profile-token": { bearerToken: () => "fixture-token", getProfileFromToken: async () => ({ id: "fixture-user", sparks: 500, tier: "pro", stripe_subscription_id: "sub_test" }), tokenClient: () => ({}) },
    "@/lib/plan-limits": planLimits,
    "@/lib/cors": { withCors: (v) => v, corsPreflight: () => {} },
    "@/lib/sparks": { estimateSparks: () => 20, MIN_ANALYZE_COST: 14, CLIP_COUNT_OPTIONS: [3], CLIP_COUNT_COST: { 3: 10 }, DEFAULT_CLIP_COUNT: 3 },
    "@/lib/twitch-chat": { detectChatSpikes: async () => null },
    "@/lib/analyze-pipeline": { runAnalysisPipeline: async () => { state.pipelineRuns++; return pipeline ? pipeline() : { clips: [], skipped: 0, durationSeconds: 600, transcriptChars: 0, words: [] }; } },
    "@/lib/vod-discovery-pipeline": { runDiscoveryPipeline: async () => { throw new Error("unexpected v2"); } },
    "@/lib/transcripts": { saveTranscript: async () => {}, loadJobTranscript: async () => null, findReusableFullTranscript: async () => null },
    "@/lib/analysis-sse": { createSafeEventSender: (controller) => ({ send: () => true, ping: () => true, close: () => { try { controller.close(); } catch { /* already closed */ } } }) },
    "@/lib/analysis-jobs": { createOrLoadAnalysisJob: async () => ({ id: "fixture-job", status: jobStatus, heartbeat_at: new Date().toISOString() }),
      isAnalysisJobStale: () => false, getAnalysisJob: async () => null,
      claimAnalysisJob: async () => { state.claims++; return "run"; },
      checkpointAnalysisJob: async () => {}, failAnalysisJob: async () => {},
      accountAnalysisJob: async () => ({ type: "result", clips: [], sparksSpent: 20, sparksBalance: 480 }) },
    "@/lib/job-queue": { runQueued: (_l, fn) => fn() },
    "@/lib/clip-access": { acquireUserProcessingSlot: countingAcquire },
    "@/lib/analysis-limits": { MAX_ANALYSES_PER_HOUR: 10,
      startedAnalysesLastHour: async () => { if (countFails) throw new Error("count failed"); return startedLastHour; } },
    "@/lib/free-capacity": { checkFreeCapacity: async () => ({ ok: true }), recordPlanAtStart: async () => {} },
    "@/lib/analyze-errors": { userFacingAnalysisError: (_s, _u, m) => m },
    "@/lib/anthropic-credit": { anthropicCreditGate: { blockOn: () => {} } },
    "@/lib/vod-source": { vodSourceKey: () => "twitch:123" },
    "@/lib/analysis-history": { priorClipWindows: async () => [] },
    "@/lib/creator-feedback-data": { preferencesForToken: async () => "" },
    "@/lib/bin": { runYtDlpCaptureWithIpv6Fallback: async () => "600", runCapture: async () => "600", resolveBin: () => "ffprobe" },
  };
  const exports = {};
  const unref = (fn, ms) => { const t = setInterval(fn, ms); t.unref?.(); return t; };
  vm.runInNewContext(routeCode, { exports, require: (n) => { if (!(n in modules)) throw new Error(`Unexpected import: ${n}`); return modules[n]; },
    process: { env: { DEPLOYMENT_TARGET: "processing", ASSEMBLYAI_API_KEY: "x", ANTHROPIC_API_KEY: "x" } },
    Response, TextEncoder, ReadableStream, setInterval: unref, clearInterval, console, Math, Number, String, Date, Error });
  const post = () => exports.POST({ json: async () => ({ url: "https://www.twitch.tv/videos/123", clipCount: 3 }) });
  return { post, state };
}
const drain = async (res) => { for await (const _ of res.body) { /* consume the SSE stream to the end */ } };

test("a second analysis while one is running is refused (409) before any claim or paid work", async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const h = routeHarness({ pipeline: async () => { await gate; return { clips: [], skipped: 0, durationSeconds: 600, transcriptChars: 0, words: [] }; } });
  const first = await h.post();
  assert.equal(first.status, 200);
  await new Promise((r) => setTimeout(r, 20)); // let the first run reach its pipeline
  const second = await h.post();
  assert.equal(second.status, 409);
  assert.match((await second.json()).error, /already have an analysis running/);
  assert.equal(h.state.claims, 1, "only the first request claimed a job");
  assert.equal(h.state.pipelineRuns, 1);
  release();
  await drain(first);
});

test("the slot is released when the analysis finishes, so the next one can start", async () => {
  const h = routeHarness();
  await drain(await h.post());
  const next = await h.post();
  assert.equal(next.status, 200);
  await drain(next);
  assert.equal(h.state.claims, 2);
});

test("the slot is released when the pipeline FAILS too", async () => {
  const h = routeHarness({ pipeline: async () => { throw new Error("download failed"); } });
  await drain(await h.post());
  const next = await h.post();
  assert.equal(next.status, 200);
  await drain(next);
});

test("the hourly cap refuses the 11th analysis (429) and frees the slot it took", async () => {
  const h = routeHarness({ startedLastHour: 10 });
  const res = await h.post();
  assert.equal(res.status, 429);
  assert.match((await res.json()).error, /last hour/);
  assert.equal(h.state.claims, 0);
  assert.equal(h.state.pipelineRuns, 0);
  // The refusal must not strand the account's one analysis slot.
  const h2 = routeHarness({ startedLastHour: 9 });
  const ok = await h2.post();
  assert.equal(ok.status, 200);
  await drain(ok);
});

test("a refused hourly request releases both slots (it can try again straight after)", async () => {
  const h = routeHarness({ startedLastHour: 10 });
  assert.equal((await h.post()).status, 429);
  assert.equal((await h.post()).status, 429); // 409 here would mean a slot leaked
});

test("if counting recent analyses fails, the customer is not blocked", async () => {
  const h = routeHarness({ countFails: true });
  const res = await h.post();
  assert.equal(res.status, 200);
  await drain(res);
  assert.equal(h.state.claims, 1);
});

test("reconnecting to a job that is already running needs no new slot", async () => {
  const h = routeHarness({ jobStatus: "running" });
  const res = await h.post();
  assert.equal(res.status, 200);
  assert.equal(h.state.acquisitions, 0);
  assert.equal(h.state.claims, 0);
  await drain(res).catch(() => {});
});
