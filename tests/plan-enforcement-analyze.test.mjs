import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as planLimits from "../lib/plan-limits.ts";
import * as vodSource from "../lib/vod-source.ts";

const H = 3600;
const code = ts.transpileModule(readFileSync(new URL("../app/api/analyze/route.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;

const PROFILES = {
  free: { tier: "free", stripe_subscription_id: null },
  pro: { tier: "pro", stripe_subscription_id: "sub_1" },
  complimentary: { tier: "pro", stripe_subscription_id: null, complimentary_pro: true },
  driftedFlag: { tier: "pro", stripe_subscription_id: null }, // "pro" flag with no subscription behind it
};
const YT = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const TW = "https://www.twitch.tv/videos/123456";

/** The real analyze route, real plan rules, everything paid or external mocked. */
function harness({ plan = "free", url = YT, uploadId, seconds = 600, sparks = 500, capacity = { ok: true } } = {}) {
  const state = { paidPipelineCalls: 0, jobsCreated: 0, claims: 0, probes: 0, uploadLookups: 0, capacityChecks: [], recorded: [] };
  const response = class extends Response { static json(value, init) { return new this(JSON.stringify(value), init); } };
  const modules = {
    "next/server": { NextResponse: response },
    "fs/promises": { mkdtemp: async () => "fixture-dir", rm: async () => {} },
    "node:crypto": { randomUUID: () => "00000000-0000-4000-8000-000000000001" },
    os: { tmpdir: () => "fixture-tmp" },
    path: { default: { join: (...p) => p.join("/") }, join: (...p) => p.join("/") },
    "@anthropic-ai/sdk": { default: class Anthropic {} },
    "@/lib/language-hint": { isMostlyEnglish: () => true, languageSection: () => '' },
    "@/lib/loud-moments": { detectLoudMoments: async () => [], formatLoudMomentsForPrompt: () => '', isQuietStream: () => false },
    "@/lib/clips": { CONTENT_TYPES: ["gaming", "irl"], DEFAULT_CONTENT_TYPE: "gaming" },
    "@/lib/video-cache": { findUploadedVideo: async () => { state.uploadLookups++; return "/fixture/upload.mp4"; } },
    "@/lib/profile-token": { bearerToken: () => "token", tokenClient: () => ({}),
      getProfileFromToken: async () => ({ id: "fixture-user", sparks, ...PROFILES[plan] }) },
    "@/lib/cors": { withCors: (v) => v, corsPreflight: () => {} },
    "@/lib/sparks": { estimateSparks: (s) => (s < 1800 ? 10 : s < 3600 ? 20 : s < 7200 ? 35 : 50), MIN_ANALYZE_COST: 14,
      CLIP_COUNT_OPTIONS: [3], CLIP_COUNT_COST: { 3: 10 }, DEFAULT_CLIP_COUNT: 3 },
    "@/lib/twitch-chat": { detectChatSpikes: async () => null },
    "@/lib/analyze-pipeline": { runAnalysisPipeline: async () => { state.paidPipelineCalls++; return { clips: [], skipped: 0, durationSeconds: seconds, transcriptChars: 0, words: [] }; } },
    "@/lib/vod-discovery-pipeline": { runDiscoveryPipeline: async () => { throw new Error("unexpected v2"); } },
    "@/lib/transcripts": { saveTranscript: async () => {}, loadJobTranscript: async () => null, findReusableFullTranscript: async () => null },
    "@/lib/analysis-sse": { createSafeEventSender: (controller) => ({ send: () => true, ping: () => true, close: () => { try { controller.close(); } catch { /* closed */ } } }) },
    "@/lib/analysis-jobs": { createOrLoadAnalysisJob: async () => { state.jobsCreated++; return { id: "fixture-job", status: "queued", heartbeat_at: new Date().toISOString() }; },
      isAnalysisJobStale: () => false, getAnalysisJob: async () => null,
      claimAnalysisJob: async () => { state.claims++; return "run"; },
      checkpointAnalysisJob: async () => {}, failAnalysisJob: async () => {},
      accountAnalysisJob: async () => ({ type: "result", clips: [], sparksSpent: 20, sparksBalance: sparks - 20 }) },
    "@/lib/job-queue": { runQueued: (_l, fn) => fn() },
    "@/lib/clip-access": { acquireUserProcessingSlot: () => () => {} },
    "@/lib/analysis-limits": { MAX_ANALYSES_PER_HOUR: 10, startedAnalysesLastHour: async () => 0 },
    "@/lib/plan-limits": planLimits,
    "@/lib/free-capacity": { checkFreeCapacity: async (o) => { state.capacityChecks.push(o); return capacity; },
      recordPlanAtStart: async (_save, planName, secs) => { state.recorded.push([planName, secs]); } },
    "@/lib/vod-source": vodSource,
    "@/lib/analyze-errors": { userFacingAnalysisError: (_s, _u, m) => m },
    "@/lib/anthropic-credit": { anthropicCreditGate: { blockOn: () => {} } },
    "@/lib/analysis-history": { priorClipWindows: async () => [] },
    "@/lib/creator-feedback-data": { preferencesForToken: async () => "" },
    "@/lib/bin": { resolveBin: () => "ffprobe",
      runCapture: async () => { state.probes++; return String(seconds); },
      runYtDlpCaptureWithIpv6Fallback: async () => { state.probes++; return String(seconds); } },
  };
  const exports = {};
  const unref = (fn, ms) => { const t = setInterval(fn, ms); t.unref?.(); return t; };
  vm.runInNewContext(code, { exports, require: (n) => { if (!(n in modules)) throw new Error(`Unexpected import: ${n}`); return modules[n]; },
    process: { env: { DEPLOYMENT_TARGET: "processing", ASSEMBLYAI_API_KEY: "x", ANTHROPIC_API_KEY: "x" } },
    Response, TextEncoder, ReadableStream, setInterval: unref, clearInterval, console, Math, Number, String, Date, Error });
  const post = () => exports.POST({ json: async () => (uploadId ? { uploadId, clipCount: 3 } : { url, clipCount: 3 }) });
  return { post, state };
}
const drain = async (res) => { for await (const _ of res.body) { /* consume the SSE stream */ } };
async function accepted(opts) {
  const h = harness(opts);
  const res = await h.post();
  assert.equal(res.status, 200, `expected accepted, got ${res.status}`);
  await drain(res);
  assert.equal(h.state.paidPipelineCalls, 1);
  return h;
}
async function rejected(opts, status, pattern) {
  const h = harness(opts);
  const res = await h.post();
  assert.equal(res.status, status);
  if (pattern) assert.match((await res.json()).error, pattern);
  assert.equal(h.state.paidPipelineCalls, 0, "no paid processing for a refused request");
  assert.equal(h.state.claims, 0, "the job must never be claimed");
  return h;
}

/* ── Free ── */
test("Free: a YouTube video up to 2 hours is accepted", async () => { await accepted({ plan: "free", url: YT, seconds: 2 * H }); });
test("Free: a YouTube video over 2 hours is rejected before any paid work", async () => {
  await rejected({ plan: "free", url: YT, seconds: 2 * H + 120 }, 413, /Free plan supports YouTube videos up to 2 hours/);
});
test("Free: a Twitch VOD up to 2 hours is accepted", async () => { await accepted({ plan: "free", url: TW, seconds: 2 * H }); });
test("Free: a Twitch VOD over 2 hours is rejected before any paid work", async () => {
  await rejected({ plan: "free", url: TW, seconds: 2 * H + 120 }, 413, /Free plan supports Twitch VODs up to 2 hours/);
});
test("Free: direct uploads are rejected outright, before a job exists or anything is probed", async () => {
  const h = await rejected({ plan: "free", uploadId: "upload-abc", seconds: 600 }, 403, /Pro feature/);
  assert.equal(h.state.jobsCreated, 0);
  assert.equal(h.state.probes, 0);
  assert.equal(h.state.uploadLookups, 0);
});

/* ── Pro ── */
for (const [label, opts] of [["YouTube", { url: YT }], ["Twitch", { url: TW }], ["upload", { uploadId: "upload-abc" }]]) {
  test(`Pro: a ${label} video up to 8 hours is accepted`, async () => { await accepted({ plan: "pro", seconds: 8 * H, ...opts }); });
  test(`Pro: a ${label} video over 8 hours is rejected before any paid work`, async () => {
    await rejected({ plan: "pro", seconds: 8 * H + 120, ...opts }, 413, /Pro plan supports .* up to 8 hours/);
  });
}
test("Pro: the old 10-hour allowance no longer applies", async () => {
  await rejected({ plan: "pro", url: YT, seconds: 9 * H }, 413);
});

/* ── who counts as Pro ── */
test("complimentary Pro (no Stripe subscription) gets Pro limits, including uploads", async () => {
  await accepted({ plan: "complimentary", uploadId: "upload-abc", seconds: 7 * H });
});
test("a 'pro' flag with no subscription behind it is treated as Free", async () => {
  await rejected({ plan: "driftedFlag", uploadId: "upload-abc", seconds: 600 }, 403);
  await rejected({ plan: "driftedFlag", url: YT, seconds: 5 * H }, 413);
});

/* ── Sparks stay a separate rule ── */
test("a video inside its plan limit still needs enough Sparks, checked before any paid processing", async () => {
  const h = harness({ plan: "free", url: YT, seconds: 1.5 * H, sparks: 20 });
  const res = await h.post();
  assert.equal(res.status, 402);
  assert.equal(h.state.paidPipelineCalls, 0);
  assert.equal(h.state.claims, 0);
});
test("a plan-limit refusal does not depend on the balance (limits and Sparks are separate)", async () => {
  await rejected({ plan: "free", url: YT, seconds: 6 * H, sparks: 9999 }, 413);
});

/* ── no way around it by shaping the request ── */
test("a spoofed shorter durationHint cannot get past the plan limit", async () => {
  const h = harness({ plan: "free", url: TW, seconds: 3 * H });
  const res = await h.post.call(null);
  // the route ignores the body's hint entirely; the verified length decides
  assert.equal(res.status, 413);
  assert.equal(h.state.paidPipelineCalls, 0);
});
test("a request with an unrecognizable source is rejected", async () => {
  const h = harness({ plan: "pro", url: "https://vimeo.com/123" });
  assert.equal((await h.post()).status, 400);
  assert.equal(h.state.paidPipelineCalls, 0);
});

/* ── Free daily capacity breaker, as wired into the route ── */
test("breaker: a Free long run is refused (429) when today's Free capacity is full, before anything is claimed", async () => {
  const h = harness({ plan: "free", url: YT, seconds: 1.5 * H, capacity: { ok: false, status: 429, message: "Free capacity for long videos is full today." } });
  const res = await h.post();
  assert.equal(res.status, 429);
  assert.match((await res.json()).error, /capacity/);
  assert.equal(h.state.claims, 0);
  assert.equal(h.state.paidPipelineCalls, 0);
});
test("breaker: the route asks with the real plan and the verified length", async () => {
  const h = harness({ plan: "free", url: YT, seconds: 2 * H });
  await drain(await h.post());
  assert.equal(h.state.capacityChecks[0].plan, "free");
  assert.equal(h.state.capacityChecks[0].durationSeconds, 2 * H);
});
test("breaker: a Pro run is passed to the breaker as Pro (which never limits it) and the plan is recorded for the job", async () => {
  const h = harness({ plan: "pro", url: YT, seconds: 3 * H });
  await drain(await h.post());
  assert.equal(h.state.capacityChecks[0].plan, "pro");
  assert.deepEqual(h.state.recorded, [["pro", 3 * H]]);
});
test("breaker: a refusal frees the account's analysis slot (it can try again straight after)", async () => {
  const h = harness({ plan: "free", url: YT, seconds: 1.5 * H, capacity: { ok: false, status: 429, message: "full" } });
  assert.equal((await h.post()).status, 429);
  assert.equal((await h.post()).status, 429);
});
