import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as planLimits from "../lib/plan-limits.ts";
import * as entitlement from "../lib/auto-clip-entitlement.ts";
import { fakeAdmin } from "./helpers/fake-admin.mjs";
import * as clipExtras from "../lib/clip-extras.ts";

const transpile = (p) => ts.transpileModule(readFileSync(new URL(p, import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const toggleCode = transpile("../app/api/streams/auto-clip/route.ts");
const eventsubCode = transpile("../app/api/twitch/eventsub/route.ts");
const workerCode = transpile("../lib/vod-poll.ts");

const PROFILES = {
  free: { id: "u-free", tier: "free", stripe_subscription_id: null },
  pro: { id: "u-pro", tier: "pro", stripe_subscription_id: "sub_1" },
  complimentary: { id: "u-comp", tier: "pro", stripe_subscription_id: null },
  driftedFlag: { id: "u-drift", tier: "pro", stripe_subscription_id: null },
};
const comp = { "u-comp": true };
const ownerOf = (plan) => PROFILES[plan];
const stream = (plan, extra = {}) => ({ id: "s1", user_id: PROFILES[plan].id, twitch_user_id: "999", twitch_login: "karmic",
  platform: "twitch", auto_clip_enabled: true, last_seen_video_id: null, created_at: "2026-01-01T00:00:00Z", ...extra });
const world = (plan, extra = {}) => fakeAdmin({
  profiles: { [PROFILES[plan].id]: PROFILES[plan] }, comp, streams: [stream(plan, extra.stream)],
  jobs: extra.jobs ?? [], checks: extra.checks ?? [], failOn: extra.failOn ?? null });
const response = class extends Response { static json(value, init) { return new this(JSON.stringify(value), init); } };

/* ── the on/off toggle route ── */
function toggleHarness(plan, { enabled = true, flag = false, failOn = null, streamOwner } = {}) {
  const admin = world(plan, { stream: { auto_clip_enabled: flag, ...(streamOwner ? { user_id: streamOwner } : {}) }, failOn,
    jobs: [{ stream_id: "s1", status: "pending" }] });
  const modules = {
    "@/lib/clip-extras": clipExtras,
    "next/server": { NextResponse: response },
    "@/lib/supabase/server": { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: PROFILES[plan].id } } }) } }) },
    "@/lib/supabase/admin": { createAdminClient: () => admin },
    "@/lib/auto-clip-entitlement": entitlement,
    "@/lib/plan-limits": planLimits,
  };
  const exports = {};
  vm.runInNewContext(toggleCode, { exports, Error, Boolean, String, console,
    require: (n) => { if (!(n in modules)) throw new Error(`Unexpected import: ${n}`); return modules[n]; } });
  return { post: () => exports.POST({ json: async () => ({ streamId: "s1", enabled }) }), admin };
}

test("toggle: Free cannot turn automatic clipping ON (403, nothing changes)", async () => {
  const h = toggleHarness("free", { enabled: true, flag: false });
  const res = await h.post();
  assert.equal(res.status, 403);
  assert.match((await res.json()).error, /Pro feature/);
  assert.equal(h.admin.state.streams[0].auto_clip_enabled, false);
});
test("toggle: a 'pro' flag with no subscription behind it cannot turn it on either", async () => {
  const h = toggleHarness("driftedFlag", { enabled: true });
  assert.equal((await h.post()).status, 403);
});
test("toggle: Pro and complimentary Pro can turn it on", async () => {
  for (const plan of ["pro", "complimentary"]) {
    const h = toggleHarness(plan, { enabled: true, flag: false });
    assert.equal((await h.post()).status, 200, plan);
    assert.equal(h.admin.state.streams[0].auto_clip_enabled, true, plan);
  }
});
test("toggle: turning it OFF is always allowed, including for Free, and clears queued work", async () => {
  const h = toggleHarness("free", { enabled: false, flag: true });
  assert.equal((await h.post()).status, 200);
  assert.equal(h.admin.state.streams[0].auto_clip_enabled, false);
  assert.equal(h.admin.state.jobs[0].status, "canceled");
});
test("toggle: if the plan cannot be read, enabling fails (500) instead of guessing", async () => {
  const h = toggleHarness("pro", { enabled: true, failOn: "profile" });
  assert.equal((await h.post()).status, 500);
  assert.equal(h.admin.state.streams[0].auto_clip_enabled, false);
});
test("toggle: someone else's channel is still not found", async () => {
  const h = toggleHarness("pro", { enabled: true, streamOwner: "someone-else" });
  assert.equal((await h.post()).status, 404);
});

/* ── the Twitch event route ── */
function eventsubHarness(plan) {
  const admin = world(plan);
  const modules = {
    "@/lib/clip-extras": clipExtras,
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
    "@/lib/twitch": { verifyEventSubSignature: () => true },
    "@/lib/supabase/admin": { createAdminClient: () => admin },
    "@/lib/auto-clip-entitlement": entitlement,
  };
  const exports = {};
  vm.runInNewContext(eventsubCode, { exports, JSON, Date, Response, URL, console, Error,
    require: (n) => { if (!(n in modules)) throw new Error(`Unexpected import: ${n}`); return modules[n]; },
    process: { env: { NEXT_PUBLIC_YOUTUBE_ENABLED: "1", DEPLOYMENT_TARGET: "processing" } } });
  const headers = new Headers({ "twitch-eventsub-message-id": "evt-1", "twitch-eventsub-message-timestamp": new Date().toISOString(),
    "twitch-eventsub-message-signature": "sha256=valid", "twitch-eventsub-message-type": "notification" });
  const body = JSON.stringify({ subscription: { type: "stream.offline" }, event: { broadcaster_user_id: "999" } });
  return { post: () => exports.POST({ headers, text: async () => body }), admin };
}
test("stream-offline event: a Pro channel queues the VOD check", async () => {
  const h = eventsubHarness("pro");
  assert.equal((await h.post()).status, 200);
  assert.equal(h.admin.state.checks.length, 1);
});
test("stream-offline event: a Free owner's channel queues nothing, is switched off, and is told once", async () => {
  const h = eventsubHarness("free");
  assert.equal((await h.post()).status, 200);
  assert.equal(h.admin.state.checks.length, 0);
  assert.equal(h.admin.state.streams[0].auto_clip_enabled, false);
  assert.equal(h.admin.state.notifications.length, 1);
  assert.match(h.admin.state.notifications[0].message, /Pro feature/);
});

/* ── the background worker ── */
function workerHarness(plan, { job, pendingCheck = false, duration = 3600 } = {}) {
  const state = { paidPipelineCalls: 0, finished: null, vodChecks: 0 };
  const j = job ?? { id: "job-1", user_id: PROFILES[plan].id, stream_id: "s1", video_id: "123", url: "https://www.twitch.tv/videos/123", duration_seconds: duration, attempts: 1 };
  const admin = world(plan, { checks: pendingCheck ? [{ id: "chk-1", stream_id: "s1", check_after: "2020-01-01", attempts: 0 }] : [] });
  let claimed = false;
  admin.rpc = async (name, args) => {
    if (name === "claim_auto_vod_job") { if (claimed || pendingCheck) return { data: [], error: null }; claimed = true; return { data: [j], error: null }; }
    if (name === "admin_get_profile") return { data: { id: j.user_id, sparks: 500 }, error: null };
    if (name === "finish_auto_vod_job") { state.finished = args; return { data: true, error: null }; }
    if (name === "enqueue_auto_vod_job") return { data: null, error: null };
    if (name === "fail_auto_vod_job" || name === "fail_auto_vod_job_limited") return { data: "failed", error: null };
    throw new Error(`Unexpected RPC: ${name}`);
  };
  const modules = {
    "@/lib/clip-extras": clipExtras,
    "fs/promises": { mkdtemp: async () => "fixture-dir", rm: async () => {} },
    os: { tmpdir: () => "fixture-tmp" }, path: { join: (...p) => p.join("/") },
    "@/lib/supabase/admin": { createAdminClient: () => admin },
    "@/lib/twitch": { getRecentVods: async () => { state.vodChecks++; return []; }, parseTwitchDuration: () => 0 },
    "@/lib/vod-discovery": { unseenVods: () => [] },
    "@/lib/analyze-pipeline": { runAnalysisPipeline: async () => { state.paidPipelineCalls++; return { clips: [], durationSeconds: j.duration_seconds }; } },
    "@/lib/vod-discovery-pipeline": { runDiscoveryPipeline: async () => { state.paidPipelineCalls++; throw new Error("unexpected v2"); } },
    "@/lib/vod-source": { vodSourceKey: () => "twitch:123" },
    "@/lib/anthropic-credit": { anthropicCreditGate: { blockOn() {} }, isAnthropicCreditBalanceError: () => false, pauseAutomaticClipping: async () => {} },
    "@/lib/creator-feedback-data": { preferencesForUser: async () => "" },
    "@/lib/clip-archive-worker": { processClipArchiveJobs: async () => {} },
    "@/lib/r2-maintenance": { processR2Maintenance: async () => {} },
    "@/lib/job-queue": { runQueued: (_l, fn) => fn() },
    "@/lib/plan-limits": planLimits,
    "@/lib/auto-clip-entitlement": entitlement,
    "@/lib/sparks": { estimateSparks: () => 20, clipCharge: () => 0, CLIP_COUNT_COST: { 5: 20 }, DEFAULT_CLIP_COUNT: 5 },
  };
  const exports = {};
  vm.runInNewContext(workerCode, { exports, console: { log() {}, warn() {}, error() {} }, setInterval() {}, setTimeout, Date, Error, Math, Number, String, Promise, Set,
    require: (n) => { if (!(n in modules)) throw new Error(`Unexpected import: ${n}`); return modules[n]; }, process: { env: {} } });
  return { start: async () => { exports.startAutoClipWorker(); await new Promise((r) => setTimeout(r, 40)); }, state, admin };
}

test("worker: a queued job for a Free owner does no paid work, no debit, and switches the channel off", async () => {
  const w = workerHarness("free");
  await w.start();
  assert.equal(w.state.paidPipelineCalls, 0);
  assert.equal(w.state.finished, null);
  assert.equal(w.admin.state.streams[0].auto_clip_enabled, false);
  assert.equal(w.admin.state.notifications.length, 1);
});
test("worker: a queued job for a Pro owner still runs", async () => {
  const w = workerHarness("pro");
  await w.start();
  assert.equal(w.state.paidPipelineCalls, 1);
  assert.equal(w.admin.state.streams[0].auto_clip_enabled, true);
});
test("worker: complimentary Pro owners still run", async () => {
  const w = workerHarness("complimentary");
  await w.start();
  assert.equal(w.state.paidPipelineCalls, 1);
});
test("worker: a pending VOD check for a Free owner is dropped without polling Twitch", async () => {
  const w = workerHarness("free", { pendingCheck: true });
  await w.start();
  assert.equal(w.state.vodChecks, 0, "Twitch must not be polled for a channel without Pro");
  assert.equal(w.admin.state.checks.length, 0);
  assert.equal(w.admin.state.streams[0].auto_clip_enabled, false);
});
test("worker: a pending VOD check for a Pro owner polls Twitch as before", async () => {
  const w = workerHarness("pro", { pendingCheck: true });
  await w.start();
  assert.equal(w.state.vodChecks, 1);
});
test("worker: the length limit is now 8 hours — a 9-hour VOD is skipped without paid work", async () => {
  const w = workerHarness("pro", { duration: 9 * 3600 });
  await w.start();
  assert.equal(w.state.paidPipelineCalls, 0);
  assert.equal(w.state.finished?.p_cost, 0);
  assert.match(w.admin.state.notifications[0].message, /over 8 hours/);
});
test("worker: an 8-hour VOD is still processed for Pro", async () => {
  const w = workerHarness("pro", { duration: 8 * 3600 });
  await w.start();
  assert.equal(w.state.paidPipelineCalls, 1);
});
