import assert from "node:assert/strict";
import test from "node:test";
import { AnthropicCreditGate, isAnthropicCreditBalanceError, pauseAutomaticClipping } from "../lib/anthropic-credit.ts";

const billingError = new Error('400 {"error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}');

test("recognizes only Anthropic insufficient-credit errors", () => {
  assert.equal(isAnthropicCreditBalanceError(billingError), true);
  assert.equal(isAnthropicCreditBalanceError(new Error("429 rate limit reached")), false);
  assert.equal(isAnthropicCreditBalanceError(new Error("Invalid API key")), false);
});

test("credit failure pause disables streams and cancels only unfinished jobs", async () => {
  const streams = [{ id: "a", auto_clip_enabled: true }, { id: "b", auto_clip_enabled: true }, { id: "c", auto_clip_enabled: false }];
  const jobs = [{ id: "1", status: "pending" }, { id: "2", status: "retry" }, { id: "3", status: "processing" }, { id: "4", status: "succeeded" }];
  const admin = {
    from(table) {
      return {
        update(patch) {
          const filters = [];
          const query = {
            eq(key, value) { filters.push(row => row[key] === value); return query; },
            in(key, values) { filters.push(row => values.includes(row[key])); return query; },
            then(resolve, reject) {
              for (const row of (table === "streams" ? streams : jobs)) {
                if (filters.every(filter => filter(row))) Object.assign(row, patch);
              }
              return Promise.resolve({ error: null }).then(resolve, reject);
            },
          };
          return query;
        },
      };
    },
  };
  await pauseAutomaticClipping(admin);
  assert.deepEqual(streams.map(row => row.auto_clip_enabled), [false, false, false]);
  assert.deepEqual(jobs.map(row => row.status), ["canceled", "canceled", "canceled", "succeeded"]);
});
test("known credit shortage blocks repeated analysis before paid transcription", () => {
  const gate = new AnthropicCreditGate();
  gate.blockOn(new Error("unrelated"), 1000);
  assert.doesNotThrow(() => gate.assertAvailable(1001));
  gate.blockOn(billingError, 1000);
  assert.throws(() => gate.assertAvailable(1001), /credit balance is too low/i);
  assert.doesNotThrow(() => gate.assertAvailable(1000 + 15 * 60_000 + 1));
});
