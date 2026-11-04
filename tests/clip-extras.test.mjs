import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as core from "../lib/provider-budget-core.ts";
import * as clipExtras from "../lib/clip-extras.ts";
import { pickExtras, isTopPick, MAX_EXTRAS } from "../lib/clip-extras.ts";
import { ClipAnalysisSchema, clipAnalysisSchemaForContentType } from "../lib/clips.ts";

const clip = (start, score) => ({ start_seconds: start, end_seconds: start + 30, viral_score: score });
const mains = (n, from = 1000) => Array.from({ length: n }, (_, i) => clip(from + i * 200, 80 - i));

/* the ranking rules */
test("7 top picks and plenty of near-misses -> exactly 3 extras, best first, to reach 10", () => {
  const extras = pickExtras({ mainPicks: mains(7), candidates: [clip(5000, 58), clip(6000, 63), clip(7000, 56), clip(8000, 61)], requestedCount: 10 });
  assert.deepEqual(extras.map((c) => c.viral_score), [63, 61, 58]);
  assert.equal(MAX_EXTRAS, 3);
});

test("only the room left is used: 9 top picks -> 1 extra, 10 -> none, 5 -> at most 3", () => {
  const cand = [clip(5000, 62), clip(6000, 61), clip(7000, 60), clip(8000, 59), clip(9000, 58)];
  assert.equal(pickExtras({ mainPicks: mains(9), candidates: cand, requestedCount: 10 }).length, 1);
  assert.equal(pickExtras({ mainPicks: mains(10), candidates: cand, requestedCount: 10 }).length, 0);
  assert.equal(pickExtras({ mainPicks: mains(5), candidates: cand, requestedCount: 10 }).length, 3);
});

test("a video with NO top pick returns the best of the stream (45 to 64), at most 3, and nothing weaker", () => {
  const best = pickExtras({ mainPicks: [], candidates: [clip(5000, 62), clip(6000, 60), clip(7000, 48), clip(8000, 46), clip(9000, 40)], requestedCount: 10 });
  assert.deepEqual(best.map((c) => c.viral_score), [62, 60, 48]);
  assert.deepEqual(pickExtras({ mainPicks: [], candidates: [clip(5000, 44), clip(6000, 30)], requestedCount: 10 }), [], "nothing worth showing at all");
  assert.deepEqual(pickExtras({ mainPicks: [], candidates: [clip(5000, 62), clip(5030, 60)], requestedCount: 1 }).length, 1, "near-duplicates collapse to one");
  assert.deepEqual(pickExtras({ mainPicks: [], candidates: [clip(5000, 62)], requestedCount: 10, priorWindows: [{ start_seconds: 4990, end_seconds: 5020 }] }), [], "already delivered moments are skipped");
});

test("a result is 'best of this stream' only when every clip is below the quality bar", async () => {
  const { isBestOfResult, BEST_OF_MIN_SCORE } = await import("../lib/clip-extras.ts");
  assert.equal(BEST_OF_MIN_SCORE, 45);
  assert.equal(isBestOfResult([{ viral_score: 62 }, { viral_score: 50 }]), true);
  assert.equal(isBestOfResult([{ viral_score: 80 }, { viral_score: 60 }]), false);
  assert.equal(isBestOfResult([]), false);
});

test("only scores from 55 up to (not including) 65 count as extras", () => {
  const extras = pickExtras({
    mainPicks: mains(3), requestedCount: 10,
    candidates: [clip(5000, 54.9), clip(6000, 55), clip(7000, 64.9), clip(8000, 65), clip(9000, 80), clip(10000, Number.NaN)],
  });
  assert.deepEqual(extras.map((c) => c.viral_score).sort((a, b) => a - b), [55, 64.9]);
});

test("extras never overlap, or start within 60s of, a top pick, an earlier extra or a moment already delivered", () => {
  const extras = pickExtras({
    mainPicks: [clip(1000, 80)], requestedCount: 10, priorWindows: [{ start_seconds: 3000, end_seconds: 3030 }],
    candidates: [clip(1040, 63), clip(1500, 62), clip(1520, 61), clip(3020, 60), clip(4000, 59)],
  });
  assert.deepEqual(extras.map((c) => c.start_seconds), [1500, 4000]);
});

test("a top pick is a clip at or above 65", () => {
  assert.equal(isTopPick({ viral_score: 65 }), true);
  assert.equal(isTopPick({ viral_score: 64.9 }), false);
});

/* Claude's answer shape */
test("the answer schema accepts a list of near-misses (max 3) and rejects more", () => {
  const shape = ClipAnalysisSchema.shape;
  assert.ok(shape.also_consider);
  assert.equal(shape.also_consider.safeParse([]).success, true);
  assert.equal(shape.also_consider.safeParse(new Array(4).fill({})).success, false);
  assert.ok(clipAnalysisSchemaForContentType("irl").shape.also_consider);
});

/* the real findClips, with Claude faked */
const nativeRequire = createRequire(import.meta.url);
const source = await readFile(new URL("../lib/analyze-pipeline.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const H = 3600;
const full = (start, score) => ({
  type: "FUNNY", signals: ["UNEXPECTED_TURN"], start_seconds: start, end_seconds: start + 30, viral_score: score, title: "t", caption: "c", reason: "r",
  hooks: ["a", "b", "c"], thumbnail_seconds: 5, dimensions: { hype: 5, emotion: 5, skill: 5, comedy: 5, storyline: 5 },
});

function harness(answer) {
  const seen = { created: [] };
  class FakeAnthropic {
    constructor() {
      this.messages = {
        create: (request) => {
          seen.created.push(request);
          return { withResponse: async () => ({
            data: { content: [{ type: "text", text: JSON.stringify(answer) }], usage: { input_tokens: 1, output_tokens: 1 } },
            response: { headers: new Headers() } }) };
        },
      };
    }
  }
  const validClip = (x) => (x && typeof x.start_seconds === "number" && typeof x.viral_score === "number"
    ? { success: true, data: x } : { success: false, error: { issues: [] } });
  const modules = {
    "@/lib/clip-extras": clipExtras,
    "@anthropic-ai/sdk": FakeAnthropic,
    "@anthropic-ai/sdk/helpers/zod": { zodOutputFormat: () => ({ type: "json_schema" }) },
    "@/lib/anthropic-rate-limits": { logAnthropicRateLimits: () => {} },
    assemblyai: { AssemblyAI: class {} },
    "@/lib/language-hint": { isMostlyEnglish: () => true, languageSection: () => '' },
    "@/lib/loud-moments": { detectLoudMoments: async () => [], formatLoudMomentsForPrompt: () => '', isQuietStream: () => false },
    "@/lib/clips": { DEFAULT_CONTENT_TYPE: "irl", CLIP_TYPES_BY_CONTENT: { irl: ["FUNNY"] }, clipAnalysisSchemaForContentType: () => ({}), clipSchemaForContentType: () => ({ safeParse: validClip }) },
    "@/lib/bin": { run: async () => {}, runCapture: async () => "10", runYtDlpWithRetry: async () => {}, resolveBin: () => "ffmpeg", FFMPEG_THREADS: 1, ffmpegLocationArgs: () => [], ytDlpThreadCapArgs: () => [] },
    "@/lib/twitch-chat": { twitchVideoId: () => null, detectChatSpikes: async () => null, formatSpikesForPrompt: () => "", spikeWindows: () => [] },
    "@/lib/vision-validation": { validateFinalistVisuals: async (c) => c },
    "@/lib/anthropic-credit": { anthropicCreditGate: { assertAvailable: () => {} } },
    "@/lib/provider-cost": { recordProviderUsage: () => {} },
    "@/lib/vod-candidates": { reviewClipBatch: (c) => ({ ready: c, flagged: [] }), clipInsideObservedCoverage: () => true },
    "@/lib/clip-boundaries": { reviewClipBatch: (c) => ({ ready: c, flagged: [] }) },
    "@/lib/format-transcript": { formatTranscript: () => "" },
    "@/lib/discovery-pool": { discoveryPoolSize: () => 10 },
    "@/lib/analysis-result-cache": { createResultCache: () => null, resultCacheKey: () => "k", selectReviewedCachedClips: () => ({ clips: [], flagged: [], readyCount: 0 }) },
    "@/lib/vod-budget": { reviewProcessingBudget: () => ({ requiresReview: false }), runLimitForSeconds: () => null },
    "@/lib/provider-budget": { budgetForRun: () => ({ call: async (_s, _m, fn) => fn() }) },
    "@/lib/provider-budget-core": core,
  };
  const context = {
    exports: {}, require: (id) => modules[id] ?? nativeRequire(id), process: { env: { ANTHROPIC_API_KEY: "x" } },
    console: { log() {}, warn() {}, error() {} }, Buffer, setTimeout, clearTimeout, Headers,
  };
  vm.runInNewContext(code, context, { filename: "analyze-pipeline.ts" });
  return { seen, run: () => context.exports.findClips("t", 4 * H, null, 10, "irl", undefined, [], [], "", "00000000-0000-4000-8000-000000000001") };
}

test("findClips: 7 top picks + 3 near-misses -> 10 clips, top picks first, extras below the bar", async () => {
  const h = harness({ clips: Array.from({ length: 7 }, (_, i) => full(1000 + i * 200, 85 - i)), also_consider: [full(5000, 61), full(5400, 58), full(5800, 56)] });
  const { clips } = await h.run();
  assert.equal(clips.length, 10);
  assert.deepEqual(Array.from(clips.slice(0, 7), (c) => isTopPick(c)), new Array(7).fill(true));
  assert.deepEqual(Array.from(clips.slice(7), (c) => c.viral_score), [61, 58, 56]);
});

test("findClips: nothing cleared the bar -> the best of the stream is returned instead of an empty page", async () => {
  const h = harness({ clips: [], also_consider: [full(5000, 61), full(5400, 58), full(9000, 40)] });
  const { clips } = await h.run();
  assert.deepEqual(Array.from(clips, (c) => c.viral_score), [61, 58], "the 40 is too weak to show");
});

test("findClips: nothing cleared the bar and nothing offered -> no clips at all", async () => {
  const h = harness({ clips: [], also_consider: [] });
  assert.equal((await h.run()).clips.length, 0);
});

test("findClips: a misplaced 70 in the extras list is not an extra, overlaps are dropped, bad entries are skipped", async () => {
  const h = harness({ clips: [full(1000, 85)], also_consider: [full(5000, 70), full(1020, 62), full(7000, 60), { garbage: true }] });
  const { clips } = await h.run();
  assert.deepEqual(Array.from(clips, (c) => c.start_seconds), [1000, 7000]);
});

test("findClips: an old-style answer with no also_consider list still works exactly as before", async () => {
  const h = harness({ clips: [full(1000, 85), full(2000, 70)] });
  assert.equal((await h.run()).clips.length, 2);
});

test("findClips: the near-miss instruction is in the prompt, and the main list's quality bar is unchanged", async () => {
  const h = harness({ clips: [full(1000, 85)] });
  await h.run();
  const system = h.seen.created[0].system;
  assert.match(system, /ALSO CONSIDER/);
  assert.match(system, /55-64/);
  assert.match(system, /best of this stream/);
  assert.match(system, /scores 45-64/);
  assert.match(system, /QUALITY FLOOR: include a clip ONLY if its viral_score is 65 or higher/);
});
