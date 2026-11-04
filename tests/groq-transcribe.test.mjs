import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isMadeUpSegment, cleanChunkWords, planChunks, stitchChunks, groqTranscribe, GROQ_MODEL, CHUNK_SECONDS, OVERLAP_SECONDS } from "../lib/groq-transcribe.ts";
import { transcriberFor } from "../lib/plan-limits.ts";
import { estimateProviderCost } from "../lib/provider-cost.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");
const w = (word, start, end) => ({ word, start, end });

test("made-up subtitle credits and non-speech segments are recognised, real speech is not", () => {
  assert.equal(isMadeUpSegment({ start: 0, end: 3, text: " Legenda Adriana Zanotto" }), true);
  assert.equal(isMadeUpSegment({ start: 0, end: 3, text: "Thanks for watching!" }), true);
  assert.equal(isMadeUpSegment({ start: 0, end: 3, text: "Subtitles by the Amara.org community" }), true);
  assert.equal(isMadeUpSegment({ start: 0, end: 3, text: "Obrigado por assistir" }), true);
  assert.equal(isMadeUpSegment({ start: 0, end: 3, text: "hello", no_speech_prob: 0.9, avg_logprob: -1.6 }), true);
  assert.equal(isMadeUpSegment({ start: 0, end: 3, text: "la la la la la", compression_ratio: 3.1 }), true);
  assert.equal(isMadeUpSegment({ start: 0, end: 3, text: "Legend of Zelda is my favourite", no_speech_prob: 0.02, avg_logprob: -0.2 }), false);
  assert.equal(isMadeUpSegment({ start: 0, end: 3, text: "Pera aí, estou tentando", no_speech_prob: 0.1, avg_logprob: -0.3 }), false);
  // "no speech" alone, or a weak guess alone, is not enough to throw words away.
  assert.equal(isMadeUpSegment({ start: 0, end: 3, text: "ok", no_speech_prob: 0.9, avg_logprob: -0.3 }), false);
  assert.equal(isMadeUpSegment({ start: 0, end: 3, text: "ok", no_speech_prob: 0.2, avg_logprob: -1.6 }), false);
});

test("words inside a made-up segment are dropped, others are kept in milliseconds", () => {
  const out = cleanChunkWords({
    words: [w(" Pera", 1, 1.4), w(" aí", 1.5, 1.8), w(" Legenda", 6, 6.4), w(" Adriana", 6.5, 7), w(" Zanotto", 7, 7.6), w(" Boa!", 12, 12.5)],
    segments: [{ start: 1, end: 2, text: " Pera aí", no_speech_prob: 0.05, avg_logprob: -0.3 }, { start: 5.8, end: 8, text: " Legenda Adriana Zanotto" }, { start: 11.8, end: 13, text: " Boa!" }],
  });
  assert.deepEqual(out.map((x) => x.text), ["Pera", "aí", "Boa!"]);
  assert.deepEqual(out[0], { text: "Pera", start: 1000, end: 1400 });
  assert.deepEqual(cleanChunkWords({}), []);
  assert.deepEqual(cleanChunkWords({ words: [w("", 0, 1), w("x", NaN, 2)] }), []);
});

test("a recording is cut into 20 minute chunks that overlap by a few seconds", () => {
  assert.deepEqual(planChunks(0), []);
  const short = planChunks(600);
  assert.equal(short.length, 1);
  assert.deepEqual(short[0], { index: 0, start: 0, length: 600, keepFrom: 0, keepUntil: Infinity });
  const long = planChunks(2 * CHUNK_SECONDS + 300);
  assert.equal(long.length, 3);
  assert.equal(long[0].start, 0);
  assert.equal(long[0].length, CHUNK_SECONDS + OVERLAP_SECONDS);
  assert.equal(long[1].start, CHUNK_SECONDS - OVERLAP_SECONDS);
  assert.equal(long[1].keepFrom, CHUNK_SECONDS);
  assert.equal(long[1].keepUntil, 2 * CHUNK_SECONDS);
  assert.equal(long[2].keepUntil, Infinity);
  assert.equal(long[2].start + long[2].length, 2 * CHUNK_SECONDS + 300);
  // Every second of the recording is owned by exactly one chunk.
  for (let i = 1; i < long.length; i++) assert.equal(long[i - 1].keepUntil, long[i].keepFrom);
});

test("chunk words go onto the recording's clock and a word in the overlap is kept once", () => {
  const plans = planChunks(2 * CHUNK_SECONDS);
  const chunk0 = { plan: plans[0], words: [{ text: "one", start: 5000, end: 5400 }, { text: "edge", start: (CHUNK_SECONDS + 1) * 1000, end: (CHUNK_SECONDS + 1.4) * 1000 }] };
  // The same "edge" word, heard again by chunk 1 (which starts 3s early), at 4s into its own clock.
  const chunk1 = { plan: plans[1], words: [{ text: "edge", start: 4000, end: 4400 }, { text: "two", start: 10_000, end: 10_300 }] };
  const stitched = stitchChunks([chunk0, chunk1]);
  assert.deepEqual(stitched.map((x) => x.text), ["one", "edge", "two"]);
  assert.equal(stitched[1].start, (CHUNK_SECONDS + 1) * 1000);
  assert.equal(stitched[2].start, (CHUNK_SECONDS - OVERLAP_SECONDS) * 1000 + 10_000);
  assert.ok(stitched.every((x, i, a) => i === 0 || a[i - 1].start <= x.start));
});

const makeDeps = (responses, calls = []) => ({
  apiKey: "test-key",
  sleep: async () => {},
  makeChunk: async () => {},
  readFile: async () => new Uint8Array([1, 2, 3]),
  tempPath: (n) => `/tmp/${n}`,
  fetchImpl: async (url, init) => { calls.push({ url, auth: init.headers.Authorization, form: init.body }); const r = responses.shift(); return typeof r === "function" ? r() : r; },
});
const ok = (json) => new Response(JSON.stringify(json), { status: 200 });

test("one chunk is sent to Groq with the key, the right model, and word times, and its words come back cleaned", async () => {
  const calls = [];
  const deps = makeDeps([ok({ language: "English", words: [w(" hello", 1, 1.5), w(" there", 1.6, 2)], segments: [{ start: 1, end: 2, text: " hello there", no_speech_prob: 0.01, avg_logprob: -0.2 }] })], calls);
  const out = await groqTranscribe(120, deps);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].auth, "Bearer test-key");
  assert.equal(calls[0].form.get("model"), GROQ_MODEL);
  assert.deepEqual(calls[0].form.getAll("timestamp_granularities[]"), ["word", "segment"]);
  assert.equal(calls[0].form.get("response_format"), "verbose_json");
  assert.deepEqual(out.words.map((x) => x.text), ["hello", "there"]);
  assert.equal(out.language, "English");
});

test("a rate limit or a short outage is retried, and Groq's own wait time is respected", async () => {
  const waits = [];
  const deps = makeDeps([new Response("slow down", { status: 429, headers: { "retry-after": "2" } }), new Response("oops", { status: 503 }), ok({ words: [w("hi", 0, 0.4)], segments: [] })]);
  deps.sleep = async (ms) => { waits.push(ms); };
  const out = await groqTranscribe(60, deps);
  assert.equal(out.words.length, 1);
  assert.equal(waits[0], 2000);
  assert.ok(waits[1] >= 1500);
});

test("a wrong key or a bad request fails right away, and giving up after repeated limits throws", async () => {
  let calls = 0;
  const deps = makeDeps([]);
  deps.fetchImpl = async () => { calls++; return new Response("no", { status: 401 }); };
  await assert.rejects(groqTranscribe(60, deps), /HTTP 401/);
  assert.equal(calls, 1);
  const limited = makeDeps([]);
  let tries = 0;
  limited.fetchImpl = async () => { tries++; return new Response("limit", { status: 429 }); };
  await assert.rejects(groqTranscribe(60, limited), /HTTP 429/);
  assert.equal(tries, 4);
});

test("a long recording is sent as several chunks and the words come back in order on one clock", async () => {
  const duration = 2 * CHUNK_SECONDS + 100;
  const plans = planChunks(duration);
  const seen = [];
  const deps = makeDeps([]);
  deps.makeChunk = async (start, length) => { seen.push({ start, length }); };
  let n = 0;
  deps.fetchImpl = async () => { const i = n++; return ok({ words: [w(`word${i}`, 10, 10.4)], segments: [] }); };
  const out = await groqTranscribe(duration, deps);
  assert.equal(seen.length, plans.length);
  assert.deepEqual(seen.map((s) => s.start), plans.map((p) => p.start));
  assert.equal(out.words.length, 3);
  assert.ok(out.words.every((x, i, a) => i === 0 || a[i - 1].start < x.start));
});

test("the chunk files are cleaned up even when a request fails", async () => {
  const removed = [];
  const deps = makeDeps([]);
  deps.removeFile = async (p) => { removed.push(p); };
  deps.fetchImpl = async () => new Response("no", { status: 400 });
  await assert.rejects(groqTranscribe(60, deps));
  assert.deepEqual(removed, ["/tmp/groq-chunk-0.mp3"]);
});

test("the rollout switch: assemblyai by default, groq only with a key, and groq-free leaves Pro alone", () => {
  const key = { GROQ_API_KEY: "gsk_x" };
  assert.equal(transcriberFor(false, {}), "assemblyai");
  assert.equal(transcriberFor(false, { TRANSCRIPTION_PROVIDER: "groq" }), "assemblyai"); // no key
  assert.equal(transcriberFor(false, { ...key }), "assemblyai"); // key but not switched on
  assert.equal(transcriberFor(false, { ...key, TRANSCRIPTION_PROVIDER: "groq-free" }), "groq");
  assert.equal(transcriberFor(true, { ...key, TRANSCRIPTION_PROVIDER: "groq-free" }), "assemblyai");
  assert.equal(transcriberFor(true, { ...key, TRANSCRIPTION_PROVIDER: " GROQ " }), "groq");
  assert.equal(transcriberFor(false, { ...key, TRANSCRIPTION_PROVIDER: "nonsense" }), "assemblyai");
  assert.equal(transcriberFor(false, { GROQ_API_KEY: "  ", TRANSCRIPTION_PROVIDER: "groq" }), "assemblyai");
});

test("Groq usage is priced at its own rate in the cost log", () => {
  assert.equal(estimateProviderCost({ runId: "r", provider: "groq", model: GROQ_MODEL, audioSeconds: 3600 }), 0.04);
  assert.equal(estimateProviderCost({ runId: "r", provider: "assemblyai", model: "universal-3-5-pro", audioSeconds: 3600 }), 0.21);
});

test("the analysis falls back to AssemblyAI if Groq fails or hears nothing, and only Free uses it in the first rollout", () => {
  const pipeline = read("lib/analyze-pipeline.ts");
  assert.match(pipeline, /transcriber === "groq" && process\.env\.GROQ_API_KEY/);
  assert.match(pipeline, /Groq failed, using AssemblyAI/);
  assert.match(pipeline, /Groq heard no speech; asking AssemblyAI to be sure/);
  assert.match(pipeline, /transcribe\(audioPath, opts\.costRunId, true, opts\.transcriber\)/);
  assert.match(read("app/api/analyze/route.ts"), /transcriber: transcriberFor\(plan === "pro"\)/);
  // The auto-clip worker (Pro) follows the same switch.
  assert.match(read("lib/vod-poll.ts"), /transcriber: transcriberFor\(true\)/);
});
