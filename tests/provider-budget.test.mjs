import test from 'node:test';
import assert from 'node:assert/strict';
import { ProviderBudget, quoteTranscription, quoteTextMessage, quoteVisualMessage, MAX_IMAGE_TOKENS,
  ASSEMBLYAI_MAX_LIST_MICRO_USD_PER_HOUR, DEFAULT_TRANSCRIPTION_RESERVE_FACTOR, transcriptionReserveFactor } from '../lib/provider-budget-core.ts';
import { AUDIO_USD_PER_HOUR } from '../lib/provider-cost.ts';

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
  assert.equal(quoteTranscription(3600), 262_500);
  assert.equal(quoteTextMessage('claude-opus-4-8', 'a', 16_000), 440_965);
  assert.equal(quoteVisualMessage('claude-sonnet-4-6', 'x', 100, 300_000), 40_431);
});

test('the image allowance is the documented per-image cap, not a guess', () => {
  // vision docs: 1,568 visual tokens on models before 4.7, 4,784 on 4.7 and later (checked 2026-11-02).
  assert.equal(MAX_IMAGE_TOKENS, 4_784);
});

test('a visual-check reservation always covers the worst real cost of one frame', () => {
  const promptBytes = 700;
  for (const model of ['claude-sonnet-4-6', 'claude-opus-4-8']) {
    const rate = { 'claude-sonnet-4-6': { in: 3, out: 15 }, 'claude-opus-4-8': { in: 5, out: 25 } }[model];
    // Worst case: the largest image the API will accept (4,784 tokens), a prompt where every byte is a token, a full 100-token reply.
    const worstRealMicroUsd = (4_784 + promptBytes) * rate.in + 100 * rate.out;
    const reserved = quoteVisualMessage(model, 'x'.repeat(promptBytes), 100, 300_000);
    assert.ok(reserved >= worstRealMicroUsd, `${model}: reserved ${reserved} < worst real ${worstRealMicroUsd}`);
  }
});

test('a visual check no longer reserves anything close to the old 100,000-token allowance', () => {
  assert.ok(quoteVisualMessage('claude-sonnet-4-6', 'x'.repeat(700), 100, 300_000) < 60_000);
});

test('a frame over the 300KB guard still cannot be priced', () => {
  assert.throws(() => quoteVisualMessage('claude-sonnet-4-6', 'x', 100, 300_001), /bounded/);
});

test('transcription is reserved from the rate card, 25% above the priciest model', () => {
  // Pins the price: if the rate card changes, this fails and the reservation is reviewed on purpose.
  assert.deepEqual(AUDIO_USD_PER_HOUR, { 'universal-3-5-pro': 0.21, 'universal-2': 0.15 });
  assert.equal(ASSEMBLYAI_MAX_LIST_MICRO_USD_PER_HOUR, 210_000);
  assert.equal(DEFAULT_TRANSCRIPTION_RESERVE_FACTOR, 1.25);
  assert.equal(quoteTranscription(7200), 525_000);
  assert.equal(quoteTranscription(1), 73); // 210000*1.25/3600 = 72.9 -> rounds up, never down
});

test('transcription reservation always covers the real list-price cost of the audio', () => {
  for (const seconds of [1, 59, 600, 3600, 5 * 3600 + 17, 10 * 3600]) {
    const realMicroUsd = seconds / 3600 * 210_000; // the best model's list price, to the second
    assert.ok(quoteTranscription(seconds) >= realMicroUsd * 1.25 - 1, String(seconds));
  }
});

test('the reservation factor can be overridden, and bad values fall back to the default', () => {
  assert.equal(transcriptionReserveFactor({ KLYP_AAI_RESERVE_FACTOR: '2' }), 2); // restores the old margin
  assert.equal(transcriptionReserveFactor({ KLYP_AAI_RESERVE_FACTOR: '1' }), 1);
  for (const bad of ['0.5', '0', '-2', '9', 'abc', '', undefined]) {
    assert.equal(transcriptionReserveFactor({ KLYP_AAI_RESERVE_FACTOR: bad }), 1.25, String(bad));
  }
  process.env.KLYP_AAI_RESERVE_FACTOR = '2';
  try { assert.equal(quoteTranscription(3600), 420_000); } finally { delete process.env.KLYP_AAI_RESERVE_FACTOR; }
});
