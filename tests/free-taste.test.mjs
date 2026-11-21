import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { unlockedIndexes, FREE_TOP_UNLOCKED, CLIP_LOCKED_MESSAGE } from "../lib/free-taste.ts";
import * as freeTaste from "../lib/free-taste.ts";
import * as planLimits from "../lib/plan-limits.ts";
import * as clipCore from "../lib/clip-access-core.ts";
import * as vodSource from "../lib/vod-source.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");
const scored = (...scores) => scores.map((viral_score) => ({ viral_score }));

test("Free keeps its best three clips open, by score, and Pro keeps all of them", () => {
  assert.equal(FREE_TOP_UNLOCKED, 3);
  assert.deepEqual([...unlockedIndexes(scored(50, 90, 30, 70, 60), false)].sort(), [1, 3, 4]);
  assert.deepEqual([...unlockedIndexes(scored(50, 90, 30, 70, 60), true)].sort(), [0, 1, 2, 3, 4]);
});

test("ties keep their order, and a short list is entirely open", () => {
  assert.deepEqual([...unlockedIndexes(scored(70, 70, 70, 70), false)].sort(), [0, 1, 2]);
  assert.deepEqual([...unlockedIndexes(scored(40, 80), false)].sort(), [0, 1]);
  assert.deepEqual([...unlockedIndexes([], false)], []);
});

function loadLock(rows) {
  const source = read("lib/free-lock.ts");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const table = (name) => {
    const q = { _f: [], select() { return q; }, eq(c, v) { q._f.push([c, v]); return q; }, order() { return q; }, limit() { return q; },
      maybeSingle: async () => ({ data: rows.profile, error: null }),
      then: (ok) => ok({ data: rows.jobs, error: null }) };
    return q;
  };
  const modules = {
    "@/lib/supabase/admin": { createAdminClient: () => ({ from: table }) },
    "@/lib/vod-source": vodSource,
    "@/lib/clip-access-core": clipCore,
    "@/lib/plan-limits": planLimits,
    "@/lib/free-taste": freeTaste,
  };
  const exports = {};
  vm.runInNewContext(code, { exports, require: (n) => { if (!(n in modules)) throw new Error(`Unexpected import ${n}`); return modules[n]; }, Promise, Number, Array, Math, Object });
  return exports.isClipLockedForFree;
}

const URL_ = "https://www.twitch.tv/videos/123";
const clips = [
  { viral_score: 90, start_seconds: 100, end_seconds: 130 },
  { viral_score: 80, start_seconds: 300, end_seconds: 330 },
  { viral_score: 70, start_seconds: 500, end_seconds: 530 },
  { viral_score: 40, start_seconds: 700, end_seconds: 730 },
  { viral_score: 30, start_seconds: 900, end_seconds: 930 },
];
const free = { tier: "free", stripe_subscription_id: null, complimentary_pro: false };
const pro = { tier: "pro", stripe_subscription_id: "sub_1", complimentary_pro: false };
const flagged = [{ analysis_clips: clips, request_payload: { freeTaste: true } }];

test("on a Free analysis the top clips are open and the others are locked", async () => {
  const locked = loadLock({ profile: free, jobs: flagged });
  assert.equal(await locked("u", URL_, 100, 130), false, "best clip");
  assert.equal(await locked("u", URL_, 500, 530), false, "third best clip");
  assert.equal(await locked("u", URL_, 700, 730), true, "fourth clip");
  assert.equal(await locked("u", URL_, 900, 930), true, "fifth clip");
  assert.equal(await locked("u", URL_, 705, 725), true, "a trim of a locked clip stays locked");
  assert.equal(await locked("u", URL_, 105, 125), false, "a trim of an open clip is fine");
});

test("Pro is never locked, even on an analysis it ran as Free", async () => {
  const locked = loadLock({ profile: pro, jobs: flagged });
  assert.equal(await locked("u", URL_, 900, 930), false);
});

test("an analysis from before this rule, or a moment outside the analysis, is never locked here", async () => {
  const old = loadLock({ profile: free, jobs: [{ analysis_clips: clips, request_payload: { sourceKey: "twitch:123" } }] });
  assert.equal(await old("u", URL_, 900, 930), false, "no freeTaste flag, so everything stays open");
  const other = loadLock({ profile: free, jobs: flagged });
  assert.equal(await other("u", URL_, 4000, 4030), false, "not a moment of this analysis: the usual ownership checks decide");
  const none = loadLock({ profile: free, jobs: [] });
  assert.equal(await none("u", URL_, 900, 930), false);
});

test("the message names the pass and says there is no extra cost in Sparks", () => {
  assert.ok(CLIP_LOCKED_MESSAGE.includes("$3 Pro pass") && CLIP_LOCKED_MESSAGE.includes("No extra Sparks"));
});

test("a Free analysis is recorded as one, so only its clips are ever locked", () => {
  const route = read("app/api/analyze/route.ts");
  assert.ok(route.includes('...(plan === "free" ? { freeTaste: true } : {})'));
});

test("every way to open a clip goes through the lock: export, preview, raw download and thumbnail", () => {
  const access = read("lib/clip-access.ts");
  assert.equal((access.match(/isClipLockedForFree\(userId, url, start, end\)/g) ?? []).length, 3, "saved clip, unsaved result and raw download");
  for (const route of ["app/api/clip/route.ts", "app/api/preview/route.ts", "app/api/thumbnail/route.ts"]) {
    assert.ok(read(route).includes("canProcessClip("), `${route} uses the checked access`);
  }
  assert.ok(read("app/api/clip/route.ts").includes('code: "clip_locked"'), "a locked clip gets its own answer");
});

test("the results page lists the locked clips instead of opening them, and the pass offer sits under them", () => {
  const panel = read("components/AnalyzePanel.tsx");
  assert.ok(panel.includes("const openClips = unlockedIndexes(clips ?? [], isPro);"));
  assert.ok(panel.includes('clipStatus[i] === "discarded" || !openClips.has(i) ? null'), "locked clips get no card");
  assert.ok(panel.includes("{!isPro && <LockedClips clips={lockedClips} />}"));
  assert.ok(panel.includes('clipStatus[index] === "unsaved" && openClips.has(index)'), "Keep all never keeps a locked clip");
  const box = read("components/LockedClips.tsx");
  assert.ok(box.includes("/dashboard/upgrade?need=unlock") && box.includes("with no extra Sparks"));
  assert.ok(box.includes("unless you cancel"), "the $28 line stays next to the offer");
});

test("Free analyzes the first hour and the upgrade page opens on the unlock reason", () => {
  assert.equal(planLimits.FREE_PART_SECONDS, 3600);
  assert.equal(planLimits.PLAN_LIMITS.free.twitch, 3600);
  assert.ok(read("app/(dashboard)/dashboard/upgrade/page.tsx").includes('"Unlock all your clips"'));
});

test("a free person can pick their own hour with the bar, or let Klyp pick the busiest one", () => {
  const panel = read("components/AnalyzePanel.tsx");
  assert.ok(panel.includes("const [ownHourFor, setOwnHourFor] = useState<string | null>(null);"));
  assert.ok(panel.includes("const windowCapSeconds = isPro ? PLAN_LIMITS.pro.twitch : FREE_PART_SECONDS;"), "the bar's limit is the plan's");
  assert.ok(panel.includes("(isPro || ownHourFor === url)"), "Pro always gets the bar; Free after choosing to pick");
  assert.ok(panel.includes("Pick my own {FREE_HOURS_WORD}") && panel.includes("Use the busiest {FREE_HOURS_WORD}"), "both choices are in the pop-up");
  assert.ok(panel.includes("Let Klyp pick the busiest {FREE_HOURS_WORD} instead"), "and they can switch back");
  assert.ok(panel.includes("capSeconds={windowCapSeconds}"));
  const route = read("app/api/analyze/route.ts");
  assert.ok(route.includes('capSeconds: plan === "free" ? FREE_PART_SECONDS'), "the server caps a chosen part at the free length");
});
