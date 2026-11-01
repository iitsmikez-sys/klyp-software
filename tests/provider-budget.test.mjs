import test from 'node:test';
import assert from 'node:assert/strict';
import { ProviderBudget, quoteTranscription, quoteTextMessage, quoteVisualMessage } from '../lib/provider-budget-core.ts';

test('a failed paid call keeps its reservation and blocks a retry over $3', async () => {
  let reserved = 0;
  let calls = 0;
  const budget = new ProviderBudget(async (_stage, microUsd) => {
    if (reserved + microUsd > 3_000_000) throw new Error('provider budget exceeded');
    reserved += microUsd;
  });
  await assert.rejects(budget.call('select', 2_000_000, async () => { calls++; throw new Error('network lost'); }), /network lost/);
  await assert.rejects(budget.call('select', 2_000_000, async () => { calls++; }), /provider budget exceeded/);
  assert.equal(calls, 1);
  assert.equal(reserved, 2_000_000);
});

test('unknown or unbounded paid calls fail before reaching the provider', async () => {
  let calls = 0;
  const budget = new ProviderBudget(async () => {});
  await assert.rejects(budget.call('select', NaN, async () => { calls++; }), /bounded/);
  assert.throws(() => quoteTextMessage('unknown-model', 'hi', 100), /model/);
  assert.throws(() => quoteTranscription(0), /duration/);
  assert.equal(calls, 0);
});

test('quotes include full output cap, image allowance, and verified audio duration', () => {
  assert.equal(quoteTranscription(3600), 420_000);
  assert.equal(quoteTextMessage('claude-opus-4-8', 'a', 16_000), 440_965);
  assert.equal(quoteVisualMessage('claude-sonnet-4-6', 'x', 100, 300_000), 326_079);
});
