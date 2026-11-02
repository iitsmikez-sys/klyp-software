import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as planLimits from "../lib/plan-limits.ts";
import { beginR2Upload, finishR2Upload } from "../lib/r2-upload-flow.ts";

const H = 3600;
const transpile = (p) => ts.transpileModule(readFileSync(new URL(p, import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const diskCode = transpile("../app/api/upload/route.ts");
const r2Code = transpile("../app/api/upload/r2/route.ts");

const PROFILES = {
  free: { id: "u-free", tier: "free", stripe_subscription_id: null },
  pro: { id: "u-pro", tier: "pro", stripe_subscription_id: "sub_1" },
  complimentary: { id: "u-comp", tier: "pro", stripe_subscription_id: null, complimentary_pro: true },
  driftedFlag: { id: "u-drift", tier: "pro", stripe_subscription_id: null },
};
const response = class extends Response { static json(value, init) { return new this(JSON.stringify(value), init); } };

/* ── disk upload route ── */
function diskHarness({ plan = "free", seconds = 600 } = {}) {
  const state = { bodyRead: false, removed: [], probes: 0, written: 0 };
  const modules = {
    "next/server": { NextResponse: response },
    fs: { createWriteStream: () => ({}) },
    "fs/promises": { mkdir: async () => {}, rm: async (p) => { state.removed.push(p); } },
    crypto: { randomUUID: () => "00000000-0000-4000-8000-0000000000aa" },
    stream: { Readable: { fromWeb: () => (async function* () { state.bodyRead = true; yield Buffer.from("x"); })() } },
    "stream/promises": { pipeline: async (source) => { for await (const _ of source()) state.written++; } },
    path: { default: { join: (...p) => p.join("/"), extname: (f) => (f.match(/\.[^.]+$/)?.[0] ?? "") }, join: (...p) => p.join("/"), extname: (f) => (f.match(/\.[^.]+$/)?.[0] ?? "") },
    "@/lib/bin": { resolveBin: () => "ffprobe", runCapture: async () => { state.probes++; return String(seconds); } },
    "@/lib/video-cache": { UPLOAD_DIR: "/uploads" },
    "@/lib/profile-token": { bearerToken: () => "t", getProfileFromToken: async () => ({ ...PROFILES[plan], sparks: 100 }) },
    "@/lib/sparks": { estimateSparks: () => 10 },
    "@/lib/plan-limits": planLimits,
    "@/lib/cors": { withCors: (v) => v, corsPreflight: () => {} },
  };
  const exports = {};
  vm.runInNewContext(diskCode, { exports, Buffer, Number, Math, String, Error, Promise, console,
    require: (n) => { if (!(n in modules)) throw new Error(`Unexpected import: ${n}`); return modules[n]; },
    process: { env: { DEPLOYMENT_TARGET: "processing" } } });
  const req = { headers: { get: (h) => ({ "x-file-name": "vod.mp4", "content-length": "1000" })[h.toLowerCase()] ?? null },
    get body() { return {}; } };
  return { post: () => exports.POST(req), state };
}

test("uploads (disk route): Free is refused with 403 before the file is read", async () => {
  const h = diskHarness({ plan: "free" });
  const res = await h.post();
  assert.equal(res.status, 403);
  assert.match((await res.json()).error, /Pro feature/);
  assert.equal(h.state.bodyRead, false);
  assert.equal(h.state.probes, 0);
});
test("uploads (disk route): a drifted 'pro' flag with no subscription is still refused", async () => {
  assert.equal((await diskHarness({ plan: "driftedFlag" }).post()).status, 403);
});
test("uploads (disk route): Pro up to 8 hours is accepted", async () => {
  const res = await diskHarness({ plan: "pro", seconds: 8 * H }).post();
  assert.equal(res.status, 200);
  assert.equal((await res.json()).durationSeconds, 8 * H);
});
test("uploads (disk route): complimentary Pro is accepted", async () => {
  assert.equal((await diskHarness({ plan: "complimentary", seconds: 600 }).post()).status, 200);
});
test("uploads (disk route): Pro over 8 hours is refused and the file is deleted", async () => {
  const h = diskHarness({ plan: "pro", seconds: 8 * H + 120 });
  const res = await h.post();
  assert.equal(res.status, 413);
  assert.match((await res.json()).error, /up to 8 hours/);
  assert.ok(h.state.removed.length >= 1, "over-length upload must be removed from disk");
});

/* ── R2 control-plane route ── */
function r2Harness({ plan = "free" } = {}) {
  const state = { begin: 0, sign: 0, finish: 0, repoGets: 0, listParts: 0 };
  const modules = {
    "next/server": { NextResponse: response },
    "@/lib/profile-token": { bearerToken: () => "t", getProfileFromToken: async () => ({ ...PROFILES[plan], sparks: 100 }) },
    "@/lib/cors": { withCors: (v) => v, corsPreflight: () => {} },
    "@/lib/bin": { resolveBin: () => "ffprobe", runCapture: async () => "60" },
    "@/lib/sparks": { estimateSparks: () => 10 },
    "@/lib/r2": { r2Storage: () => ({ listParts: async () => { state.listParts++; return []; } }) },
    "@/lib/r2-upload-flow": { R2_PART_BYTES: 16 * 1024 * 1024,
      beginR2Upload: async () => { state.begin++; return { id: "upl", partBytes: 1, parts: 1 }; },
      signR2UploadPart: async () => { state.sign++; return "https://r2.test/part"; },
      finishR2Upload: async () => { state.finish++; return { uploadId: "upl", durationSeconds: 60 }; } },
    "@/lib/r2-upload-store": { r2UploadRepository: { get: async () => { state.repoGets++; return { id: "upl", userId: PROFILES[plan].id, status: "uploading", expiresAt: new Date(Date.now() + 1e6).toISOString(), key: "k", remoteId: "r" }; } } },
    "@/lib/r2-usage": { recordR2UsageEvent: async () => {} },
    "@/lib/plan-limits": planLimits,
  };
  const exports = {};
  vm.runInNewContext(r2Code, { exports, Number, Math, String, Error, Promise, console, URL,
    require: (n) => { if (!(n in modules)) throw new Error(`Unexpected import: ${n}`); return modules[n]; },
    process: { env: { DEPLOYMENT_TARGET: "processing", R2_WRITES_ENABLED: "1" } } });
  const post = (body) => exports.POST({ json: async () => body });
  const get = (uploadId) => exports.GET({ url: `http://x/api/upload/r2${uploadId ? `?uploadId=${uploadId}` : ""}`, headers: { get: () => null } });
  return { post, get, state };
}

test("uploads (R2 route): Free cannot start, sign a part, or finish an upload", async () => {
  const h = r2Harness({ plan: "free" });
  for (const body of [{ action: "start", fileName: "v.mp4", bytes: 1000 }, { action: "part", uploadId: "upl", partNumber: 1 }, { action: "finish", uploadId: "upl" }]) {
    const res = await h.post(body);
    assert.equal(res.status, 403, body.action);
    assert.match((await res.json()).error, /Pro feature/);
  }
  assert.deepEqual([h.state.begin, h.state.sign, h.state.finish], [0, 0, 0]);
});
test("uploads (R2 route): Free cannot resume an upload either", async () => {
  const h = r2Harness({ plan: "free" });
  const res = await h.get("upl");
  assert.equal(res.status, 403);
  assert.equal(h.state.repoGets, 0);
  assert.equal(h.state.listParts, 0);
});
test("uploads (R2 route): Pro and complimentary Pro can start, sign and finish", async () => {
  for (const plan of ["pro", "complimentary"]) {
    const h = r2Harness({ plan });
    assert.equal((await h.post({ action: "start", fileName: "v.mp4", bytes: 1000 })).status, 200, plan);
    assert.equal((await h.post({ action: "part", uploadId: "upl", partNumber: 1 })).status, 200, plan);
    assert.equal((await h.post({ action: "finish", uploadId: "upl" })).status, 200, plan);
    assert.deepEqual([h.state.begin, h.state.sign, h.state.finish], [1, 1, 1], plan);
  }
});
test("uploads (R2 route): the unauthenticated capability probe still works so the UI can decide what to show", async () => {
  const res = await r2Harness({ plan: "free" }).get(null);
  assert.equal(res.status, 200);
});

/* ── R2 finish: the length ceiling is the Pro upload limit ── */
const MB = 1024 * 1024;
function r2Fixture() {
  const rows = new Map();
  let head = null;
  const repo = { async insert(row) { rows.set(row.id, row); }, async get(id) { return rows.get(id) ?? null; },
    async markReady(id, s) { rows.set(id, { ...rows.get(id), status: "ready", durationSeconds: s }); } };
  const r2 = { async createMultipart() { return "remote"; }, async signPart() { return "url"; },
    async listParts() { return [{ partNumber: 1, etag: "e", bytes: 16 * MB }, { partNumber: 2, etag: "e2", bytes: 1 * MB }]; },
    async complete() { head = { bytes: 17 * MB, etag: "x" }; }, async head() { return head; },
    async signedGet() { return "https://r2.test/source"; }, async abort() {} };
  return { repo, r2 };
}
const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

test("R2 finish: an 8-hour upload becomes ready", async () => {
  const { repo, r2 } = r2Fixture();
  const up = await beginR2Upload(owner, "vod.mp4", 17 * MB, repo, r2);
  assert.deepEqual(await finishR2Upload(owner, up.id, repo, r2, async () => 8 * H), { uploadId: up.id, durationSeconds: 8 * H });
});
for (const seconds of [8 * H + 60, 10 * H]) {
  test(`R2 finish: a ${(seconds / H).toFixed(2)}-hour upload is refused`, async () => {
    const { repo, r2 } = r2Fixture();
    const up = await beginR2Upload(owner, "vod.mp4", 17 * MB, repo, r2);
    await assert.rejects(finishR2Upload(owner, up.id, repo, r2, async () => seconds), /exceeds 8 hours/);
  });
}
