import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateProviderCost, recordProviderUsage } from '../lib/provider-cost.ts';

test('prices measured transcription seconds and Claude token usage', () => {
  assert.equal(estimateProviderCost({ runId: 'run-1', provider: 'assemblyai', model: 'universal-3-5-pro', audioSeconds: 3600 }), 0.21);
  assert.equal(estimateProviderCost({ runId: 'run-1', provider: 'assemblyai', model: 'universal-2', audioSeconds: 1800 }), 0.075);
  assert.equal(estimateProviderCost({ runId: 'run-1', provider: 'anthropic', model: 'claude-opus-4-8', inputTokens: 20000, outputTokens: 5000, cacheReadTokens: 0, cacheWriteTokens: 0 }), 0.225);
  assert.equal(estimateProviderCost({ runId: 'run-1', provider: 'anthropic', model: 'claude-sonnet-4-6', inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 }), 0.0045);
});

test('records raw units and leaves unknown model prices unestimated', () => {
  const lines = [];
  recordProviderUsage({ runId: 'run-2', provider: 'assemblyai', model: 'future-model', audioSeconds: 900 }, (line) => lines.push(line));
  const data = JSON.parse(lines[0].replace('[provider-usage] ', ''));
  assert.equal(data.runId, 'run-2');
  assert.equal(data.audioSeconds, 900);
  assert.equal(data.estimatedUsd, null);
});
