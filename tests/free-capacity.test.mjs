import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as vodBudget from "../lib/vod-budget.ts";

const H = 3600;
const code = ts.transpileModule(readFileSync(new URL("../lib/free-capacity.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;

function load({ rows = [], error = null, env = {} } = {}) {
  const calls = [];
  const chain = { select(...a) { calls.push(["select", ...a]); return chain; }, eq(...a) { calls.push(["eq", ...a]); return chain; },
    gte(...a) { calls.push(["gte", ...a]); return chain; }, limit(...a) { calls.push(["limit", ...a]); return Promise.resolve({ data: rows, error }); } };
  const exports = {};
  vm.runInNewContext(code, { exports, Number, Math, Date, Array, console: { error() {}, warn() {}, log() {} },
    require: (n) => ({ "@/lib/supabase/admin": { createAdminClient: () => ({ from: (t) => { calls.push(["from", t]); return chain; } }) },
      "@/lib/vod-budget": vodBudget }[n] ?? (() => { throw new Error(`Unexpected import: ${n}`); })()),
    process: { env } });
  return { ...exports, calls };
}
const NOW = Date.parse("2026-11-02T15:30:00Z");

test("only Free runs longer than an hour are limited; Pro and short Free runs always pass", async () => {
  const m = load();
  const full = async () => ({ micro: 999_000_000 }); // far over the limit
  assert.equal((await m.checkFreeCapacity({ plan: "pro", durationSeconds: 8 * H, loadSpend: full })).ok, true);
  assert.equal((await m.checkFreeCapacity({ plan: "free", durationSeconds: 1 * H, loadSpend: full })).ok, true);
  assert.equal((await m.checkFreeCapacity({ plan: "free", durationSeconds: 600, loadSpend: full })).ok, true);
  assert.equal((await m.checkFreeCapacity({ plan: "free", durationSeconds: 1 * H + 1, loadSpend: full })).ok, false);
});

test("a Free long run passes while today's spend plus its own estimate fits the limit, and is refused once it would not", async () => {
  const m = load();
  const est = m.estimateRunMicroUsd(4 * H);
  assert.ok(est > 1_000_000 && est < 3_000_000, `4h estimate ${est} micro-USD should be a couple of dollars`);
  const limit = 25_000_000;
  const spend = (micro) => async () => ({ micro });
  assert.equal((await m.checkFreeCapacity({ plan: "free", durationSeconds: 4 * H, loadSpend: spend(limit - est) })).ok, true);
  const refused = await m.checkFreeCapacity({ plan: "free", durationSeconds: 4 * H, loadSpend: spend(limit - est + 1) });
  assert.equal(refused.ok, false);
  assert.equal(refused.status, 429);
  assert.match(refused.message, /Free capacity for long videos is full today/);
});

test("the daily limit is $25 by default and can be changed with KLYP_FREE_DAILY_LIMIT_USD", async () => {
  assert.equal(load().freeDailyLimitUsd({}), 25);
  assert.equal(load().freeDailyLimitUsd({ KLYP_FREE_DAILY_LIMIT_USD: "10" }), 10);
  for (const bad of ["0", "-5", "abc", ""]) assert.equal(load().freeDailyLimitUsd({ KLYP_FREE_DAILY_LIMIT_USD: bad }), 25, bad);
  const m = load({ env: { KLYP_FREE_DAILY_LIMIT_USD: "1" } }); // a $1 limit: a 4h run's estimate alone exceeds it
  assert.equal((await m.checkFreeCapacity({ plan: "free", durationSeconds: 4 * H, loadSpend: async () => ({ micro: 0 }) })).ok, false);
});

test("a retry of a job that was already counted is never refused again", async () => {
  const m = load();
  const r = await m.checkFreeCapacity({ plan: "free", durationSeconds: 4 * H, alreadyCounted: true, loadSpend: async () => ({ micro: 999_000_000 }) });
  assert.equal(r.ok, true);
});

test("the day starts at 00:00 UTC", () => {
  const m = load();
  assert.equal(m.utcDayStart(NOW), "2026-11-02T00:00:00.000Z");
  assert.equal(m.utcDayStart(Date.parse("2026-11-02T23:59:59Z")), "2026-11-02T00:00:00.000Z");
  assert.equal(m.utcDayStart(Date.parse("2026-11-03T00:00:00Z")), "2026-11-03T00:00:00.000Z");
});

test("the lookup counts only Free jobs created since the start of the UTC day", async () => {
  const m = load({ rows: [{ est_cost_micro_usd: 1_500_000 }, { est_cost_micro_usd: null }, { est_cost_micro_usd: 2_000_000 }] });
  const r = await m.checkFreeCapacity({ plan: "free", durationSeconds: 4 * H, now: NOW });
  assert.equal(r.ok, true);
  assert.deepEqual(m.calls.find((c) => c[0] === "from"), ["from", "analysis_jobs"]);
  assert.deepEqual(m.calls.find((c) => c[0] === "eq"), ["eq", "plan_at_start", "free"]);
  assert.deepEqual(m.calls.find((c) => c[0] === "gte"), ["gte", "created_at", "2026-11-02T00:00:00.000Z"]);
});

test("the sum of recorded Free spend is what is compared with the limit", async () => {
  const m = load({ rows: Array.from({ length: 14 }, () => ({ est_cost_micro_usd: 1_800_000 })) }); // $25.2 already spent
  const r = await m.checkFreeCapacity({ plan: "free", durationSeconds: 2 * H, now: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.status, 429);
});

test("before migration 037 is applied the breaker is off (missing column is not an outage)", async () => {
  for (const error of [{ code: "42703", message: "column analysis_jobs.plan_at_start does not exist" }, { code: "PGRST204", message: "x" }]) {
    const m = load({ error });
    assert.equal((await m.checkFreeCapacity({ plan: "free", durationSeconds: 4 * H, now: NOW })).ok, true);
  }
});

test("any other lookup failure refuses the Free long run (fail closed) with a retry-soon message", async () => {
  const m = load({ error: { code: "08006", message: "connection lost" } });
  const r = await m.checkFreeCapacity({ plan: "free", durationSeconds: 4 * H, now: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.status, 503);
  // ...but never for runs the breaker does not cover
  assert.equal((await m.checkFreeCapacity({ plan: "pro", durationSeconds: 4 * H, now: NOW })).ok, true);
  assert.equal((await m.checkFreeCapacity({ plan: "free", durationSeconds: 1800, now: NOW })).ok, true);
});

test("recording the plan for a job is best effort: a failure (e.g. the migration is missing) never fails the analysis", async () => {
  const m = load();
  let saved = null;
  await m.recordPlanAtStart(async (changes) => { saved = changes; }, "free", 3 * H);
  assert.equal(saved.plan_at_start, "free");
  assert.equal(saved.est_cost_micro_usd, m.estimateRunMicroUsd(3 * H));
  await assert.doesNotReject(m.recordPlanAtStart(async () => { throw new Error("column does not exist"); }, "pro", 3 * H));
});

test("estimates grow with length and match the existing preflight formula", () => {
  const m = load();
  assert.ok(m.estimateRunMicroUsd(4 * H) > m.estimateRunMicroUsd(1 * H));
  assert.equal(m.estimateRunMicroUsd(4 * H), Math.round(vodBudget.projectedRunUsd(4 * H) * 1_000_000));
});

test("migration 037 is additive and nullable", () => {
  const sql = readFileSync(new URL("../supabase/migrations/037_free_capacity.sql", import.meta.url), "utf8");
  assert.match(sql, /add column if not exists plan_at_start text/);
  assert.match(sql, /add column if not exists est_cost_micro_usd bigint/);
  assert.doesNotMatch(sql, /not null|drop |delete |update public/i);
});
