import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { findWordLoops, repairWindowsFor, spliceRepaired, collapseLoops, LOOP_MIN_MATCHES } from "../lib/whisper-loops.ts";
import { groqTranscribe, DEEPINFRA_MODEL, DEEPINFRA_URL, GROQ_URL, GROQ_MODEL } from "../lib/groq-transcribe.ts";
import { transcriberFor } from "../lib/plan-limits.ts";
import { estimateProviderCost } from "../lib/provider-cost.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");
const word = (text, i) => ({ text, start: i * 400, end: i * 400 + 300 });
const seq = (texts, from = 0) => texts.map((t, i) => word(t, from + i));
const speech = (n, from = 0) => seq(Array.from({ length: n }, (_, i) => ["we", "got", "a", "great", "play", "going", "on", "here", "now", "chat"][i % 10] + (i >= 10 ? i : "")), from);

test("a word repeated over and over is found as one loop, in the right place", () => {
  const words = [...speech(30), ...seq(Array(119).fill("Run."), 30), ...speech(30, 149)];
  const loops = findWordLoops(words);
  assert.equal(loops.length, 1);
  assert.equal(loops[0].period, 1);
  assert.equal(loops[0].fromIndex, 30);
  assert.equal(loops[0].toIndex, 148);
  assert.equal(loops[0].startMs, 30 * 400);
});

test("a repeating short phrase is found too, and ordinary repeats are left alone", () => {
  const phrase = seq(Array.from({ length: 12 }, (_, i) => (i % 2 ? "you" : "thank")), 10);
  assert.equal(findWordLoops([...speech(10), ...phrase, ...speech(10, 22)]).length, 1);
  // people really do say "no no no no" or "go go go go go go"
  assert.equal(findWordLoops([...speech(10), ...seq(["no", "no", "no", "no", "no", "no"], 10), ...speech(10, 16)]).length, 0);
  assert.equal(findWordLoops(speech(200)).length, 0);
  assert.equal(findWordLoops([]).length, 0);
  assert.ok(LOOP_MIN_MATCHES >= 6, "the bar stays above normal repeated speech");
});

test("punctuation and capitals do not hide a loop", () => {
  const words = seq(["Yeah.", "yeah", "YEAH!", "yeah,", "Yeah", "yeah.", "yeah", "Yeah.", "yeah", "yeah!"]);
  assert.equal(findWordLoops(words).length, 1);
});

test("the stretch to repair is the loop with room on both sides, joined with a close neighbour and kept inside the recording", () => {
  const loops = [{ fromIndex: 0, toIndex: 5, period: 1, startMs: 20_000, endMs: 30_000 }, { fromIndex: 9, toIndex: 20, period: 1, startMs: 35_000, endMs: 50_000 }, { fromIndex: 50, toIndex: 90, period: 1, startMs: 300_000, endMs: 305_000 }];
  assert.deepEqual(repairWindowsFor(loops, 10_000, 308_000), [{ startMs: 10_000, endMs: 60_000 }, { startMs: 290_000, endMs: 308_000 }]);
  assert.deepEqual(repairWindowsFor([{ fromIndex: 0, toIndex: 5, period: 1, startMs: 2000, endMs: 4000 }], 10_000), [{ startMs: 0, endMs: 14_000 }]);
  assert.deepEqual(repairWindowsFor([]), []);
});

test("the repaired stretch replaces only the words inside its window", () => {
  const words = [...speech(5), ...seq(Array(20).fill("Run."), 5), ...speech(5, 25)];
  const window = { startMs: 5 * 400, endMs: 25 * 400 };
  const fixed = [{ text: "that was it", start: 5 * 400 + 100, end: 5 * 400 + 900 }, { text: "outside", start: 30 * 400, end: 30 * 400 + 100 }];
  const out = spliceRepaired(words, window, fixed);
  assert.equal(out.length, 5 + 1 + 5, "the loop is gone, one repaired phrase in, anything outside the window ignored");
  assert.ok(out.some((w) => w.text === "that was it"));
  assert.ok(!out.some((w) => w.text === "Run."));
  assert.ok(!out.some((w) => w.text === "outside"));
  assert.deepEqual(out.map((w) => w.start), [...out.map((w) => w.start)].sort((a, b) => a - b));
  assert.equal(spliceRepaired(words, window, []).length, 10, "silence means the loop was made up and nothing replaces it");
});

test("when a loop cannot be repaired, the first three repeats are kept and the rest dropped", () => {
  const words = [...speech(10), ...seq(Array(119).fill("Run."), 10), ...speech(10, 129)];
  const out = collapseLoops(words);
  assert.equal(out.filter((w) => w.text === "Run.").length, 3);
  assert.equal(out.length, 23);
  assert.equal(collapseLoops(speech(50)).length, 50);
});

test("DeepInfra is called with its own address, model and key, and says so in errors", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push({ url, model: init.body.get("model"), auth: init.headers.Authorization, temp: init.body.get("temperature") }); return { ok: true, status: 200, headers: new Headers(), json: async () => ({ words: [{ word: " hi", start: 0.1, end: 0.4 }], segments: [], language: "en" }) }; };
  const deps = (extra = {}) => ({ apiKey: "di-test", fetchImpl, sleep: async () => {}, makeChunk: async () => {}, readFile: async () => new Uint8Array(4), tempPath: (n) => n, ...extra });
  const out = await groqTranscribe(60, deps({ url: DEEPINFRA_URL, model: DEEPINFRA_MODEL, name: "DeepInfra" }));
  assert.equal(out.words.length, 1);
  assert.deepEqual(seen[0], { url: DEEPINFRA_URL, model: DEEPINFRA_MODEL, auth: "Bearer di-test", temp: "0" });
  await groqTranscribe(60, deps());
  assert.deepEqual([seen[1].url, seen[1].model], [GROQ_URL, GROQ_MODEL], "Groq stays the default");
  const failing = async () => ({ ok: false, status: 402, headers: new Headers(), json: async () => ({}) });
  await assert.rejects(() => groqTranscribe(60, deps({ fetchImpl: failing, name: "DeepInfra" })), /DeepInfra transcription failed \(HTTP 402\)/);
});

test("who is transcribed by DeepInfra: nobody until it is switched on, then everyone or only Free accounts", () => {
  const key = { DEEPINFRA_API_KEY: "k" };
  assert.equal(transcriberFor(false, key), "assemblyai", "a key alone changes nothing");
  assert.equal(transcriberFor(false, { ...key, TRANSCRIPTION_PROVIDER: "deepinfra-free" }), "deepinfra");
  assert.equal(transcriberFor(true, { ...key, TRANSCRIPTION_PROVIDER: "deepinfra-free" }), "assemblyai", "Pro stays on AssemblyAI in free-only mode");
  assert.equal(transcriberFor(true, { ...key, TRANSCRIPTION_PROVIDER: "deepinfra" }), "deepinfra");
  assert.equal(transcriberFor(false, { TRANSCRIPTION_PROVIDER: "deepinfra" }), "assemblyai", "no key means AssemblyAI");
  assert.equal(transcriberFor(false, { GROQ_API_KEY: "g", TRANSCRIPTION_PROVIDER: "groq" }), "groq", "the Groq switch still works");
  assert.equal(transcriberFor(false, {}), "assemblyai");
});

test("DeepInfra's cost is recorded at its own rate", () => {
  const usd = estimateProviderCost({ runId: "r", provider: "deepinfra", model: DEEPINFRA_MODEL, audioSeconds: 3600 });
  assert.equal(usd, 0.012);
});

test("the pipeline sends the transcript to DeepInfra, repairs loops with AssemblyAI, and falls back to AssemblyAI if DeepInfra fails", () => {
  const pipeline = read("lib/analyze-pipeline.ts");
  assert.ok(pipeline.includes('if (transcriber === "deepinfra" && process.env.DEEPINFRA_API_KEY && Number.isFinite(measured) && measured > 0) {'));
  assert.ok(pipeline.includes("const viaDeepInfra = await transcribeWithDeepInfra(audioPath, measured, costRunId);\n    if (viaDeepInfra) return viaDeepInfra;"));
  assert.ok(pipeline.includes("const loops = findWordLoops(words);"));
  assert.ok(pipeline.includes('(await transcribe(target, costRunId, false, "assemblyai"))'), "the loop stretch is re-done by AssemblyAI");
  assert.ok(pipeline.includes("words = collapseLoops(words) as TimedWord[];"), "any loop left is trimmed");
  assert.ok(pipeline.includes("[transcribe] DeepInfra failed, using AssemblyAI"));
  assert.ok(pipeline.includes('console.log("[transcribe] DeepInfra heard no speech; asking AssemblyAI to be sure");'));
  assert.ok(pipeline.includes('provider: "deepinfra", model: DEEPINFRA_MODEL, audioSeconds: measured'));
});
