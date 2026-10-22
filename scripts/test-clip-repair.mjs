import assert from "node:assert/strict";
import { test } from "node:test";
import { offsetRecoveredWords, cleanRepairHooks } from "../lib/clip-repair.ts";

test("recovered clip words use the original VOD timeline", () => {
  const words = [
    { text: "Hello", start: 200, end: 500 },
    { text: "world", start: 1200, end: 1500 },
    { text: "outside", start: 31000, end: 31400 },
  ];
  assert.deepEqual(offsetRecoveredWords(words, 140, 30), [
    { text: "Hello", start: 140200, end: 140500 },
    { text: "world", start: 141200, end: 141500 },
  ]);
});

test("hook repair rejects duplicate or overlong AI options", () => {
  assert.deepEqual(cleanRepairHooks(["Chat went wild!", "The plan backfired", "He couldn't believe it"]), [
    "Chat went wild", "The plan backfired", "He couldn't believe it",
  ]);
  assert.equal(cleanRepairHooks(["same", "SAME", "different"]), null);
  assert.equal(cleanRepairHooks(["one two three four five six seven eight", "ok", "yes"]), null);
});
