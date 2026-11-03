import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { formatTranscript } from "../lib/format-transcript.ts";

const w = (text, start = 0) => ({ text, start, end: start + 300 });

/* ── shorter transcript for Claude ── */
test("fillers (um, uh, er and stretched forms) are dropped from the prompt text when asked", () => {
  const words = ["so", "um", "I", "uh", "went", "uhhh", "there", "ummm", "and", "Um,", "er", "erm", "left"].map((t, i) => w(t, i * 300));
  assert.equal(formatTranscript(words, { dropFillers: true }), "[0:00] so I went there and left");
});

test("it never touches real words, reactions or repeats", () => {
  const words = ["umbrella", "number", "hmm", "mm", "no", "no", "no", "no", "errr-", "user", "humor", "super"].map((t, i) => w(t, i * 300));
  const text = formatTranscript(words, { dropFillers: true });
  for (const keep of ["umbrella", "number", "hmm", "mm", "user", "humor", "super"]) assert.ok(text.includes(keep), keep);
  assert.equal(text.match(/\bno\b/g).length, 4); // "no no no no" is a reaction signal, kept whole
});

test("off by default: the plain transcript (used elsewhere) is unchanged, and the word list is never modified", () => {
  const words = [w("so"), w("um", 300), w("go", 600)];
  assert.equal(formatTranscript(words), "[0:00] so um go");
  formatTranscript(words, { dropFillers: true });
  assert.equal(words.length, 3);
  assert.equal(words[1].text, "um"); // captions and timing still see every word
});

test("a block made only of fillers produces no empty line, and timestamps stay correct for the rest", () => {
  const words = [w("um", 0), w("uh", 300), w("later", 25_000), w("words", 25_300)];
  const text = formatTranscript(words, { dropFillers: true });
  assert.equal(text, "[0:20] later words");
});

/* ── reuse of a transcript, including another user's for public videos ── */
const source = readFileSync(new URL("../lib/transcripts.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;

function harness({ own = [], shared = [], sharedError = false } = {}) {
  const calls = { own: 0, shared: 0 };
  const rows = (list) => ({ select() { return q(list); } });
  const q = (list) => { const o = { eq() { return o; }, order() { return o; }, limit() { return Promise.resolve({ data: list, error: null }); } }; return o; };
  const modules = {
    "@/lib/profile-token": { tokenClient: () => ({ from() { calls.own++; return rows(own); } }) },
    "@/lib/supabase/admin": { createAdminClient: () => ({ from() { calls.shared++; if (sharedError) throw new Error("db down"); return rows(shared); } }) },
  };
  const exports = {};
  vm.runInNewContext(code, { exports, require: (n) => modules[n], console, Error, Number, Math, Promise });
  return { find: exports.findReusableFullTranscript, calls, exports };
}
const row = (seconds, tag) => ({ words: [{ text: tag, start: 0, end: 1 }], duration_seconds: seconds, coverage_mode: "full" });

test("reuse: your own earlier transcript is used first, and the shared lookup is never made", async () => {
  const h = harness({ own: [row(3600, "own")], shared: [row(3600, "other")] });
  const t = await h.find("tok", "twitch:123", 3600);
  assert.equal(t.words[0].text, "own");
  assert.equal(h.calls.shared, 0);
});

test("reuse: another user's transcript of the same PUBLIC video is reused, so the paid transcription is skipped", async () => {
  for (const key of ["twitch:2916285574", "youtube:dQw4w9WgXcQ"]) {
    const h = harness({ own: [], shared: [row(12_000, "shared")] });
    const t = await h.find("tok", key, 12_010);
    assert.equal(t.words[0].text, "shared", key);
    assert.equal(t.coverageMode, "full");
  }
});

test("reuse: never for uploads (private files), whatever is in the table", async () => {
  const h = harness({ own: [], shared: [row(600, "private")] });
  assert.equal(await h.find("tok", "upload:abc123", 600), null);
  assert.equal(h.calls.shared, 0);
  assert.equal(h.exports.isSharedSource("upload:abc123"), false);
  assert.equal(h.exports.isSharedSource("twitch:123"), true);
  assert.equal(h.exports.isSharedSource("twitch:abc"), false);
});

test("reuse: a transcript of a different length is not used (a stream that was still live earlier)", async () => {
  const h = harness({ own: [row(1800, "stale-own")], shared: [row(2000, "stale-shared")] });
  assert.equal(await h.find("tok", "twitch:123", 12_000), null);
  const ok = harness({ own: [], shared: [row(12_030, "fine")] });
  assert.equal((await ok.find("tok", "twitch:123", 12_000)).words[0].text, "fine"); // within a minute
});

test("reuse: if the shared lookup fails, the analysis carries on (no transcript, not an error)", async () => {
  const h = harness({ own: [], sharedError: true });
  assert.equal(await h.find("tok", "twitch:123", 3600), null);
});
