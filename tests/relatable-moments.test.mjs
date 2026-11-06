import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");
const pipeline = read("lib/analyze-pipeline.ts");

test("the prompt names the calm clips top channels post, so they are looked for on purpose", () => {
  assert.match(pipeline, /RELATABLE MOMENTS ARE CLIPS TOO/);
  for (const kind of [/relatable confession/i, /honest self-own/i, /quirky bit/i, /gratitude or community moment/i, /gross-out or embarrassing mini-story/i]) {
    assert.match(pipeline, kind);
  }
  assert.match(pipeline, /never on how loud the streamer is/);
  assert.match(pipeline, /it does not apply to these/);
});

test("relatable confessions count as a clip signal, not only one-liners", () => {
  assert.match(pipeline, /short relatable confession: one complete thought of roughly 15-25 seconds/);
});

test("scoring has a share trigger: who would send, save or comment, and why", () => {
  assert.match(pipeline, /SHARE TRIGGER: ask who would send this to a friend, save it, or comment on it, and why/);
  assert.match(pipeline, /say who would share or save it and why/);
});

test("the target length is 15-35 seconds, short single-thought clips are welcome, and nothing is ever under 15", () => {
  assert.match(pipeline, /AIM FOR 15-35 seconds/);
  assert.match(pipeline, /15-25 seconds is ideal|single-thought clip of 15-25 seconds with a clean ending is ideal/);
  assert.match(pipeline, /never under 15 seconds/);
  assert.match(pipeline, /15-60 seconds per clip is the hard range/);
});

test("relatable, story and confession clips may get a curiosity-question title", () => {
  assert.match(pipeline, /a curiosity question also works well/);
  assert.match(pipeline, /Why he cancels plans at the last minute/);
});
