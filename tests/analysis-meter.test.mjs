import test from 'node:test';
import assert from 'node:assert/strict';
import { createStageMeter, archiveUsageEvent } from '../lib/analysis-meter.ts';

test('stage meter records elapsed time, bytes, and actual provider units without inventing invoice charges', () => {
  const lines = [];
  let clock = 100;
  const meter = createStageMeter('run-1', line => lines.push(line), () => clock);
  const finish = meter.start('download');
  clock = 450;
  finish({ bytesDownloaded: 2048 });
  meter.provider('transcribe', { runId: 'run-1', provider: 'assemblyai', model: 'universal-3-5-pro', audioSeconds: 600 });
  const events = lines.map(line => JSON.parse(line.slice(line.indexOf('{'))));
  assert.deepEqual(events.map(e => e.stage), ['download', 'transcribe']);
  assert.equal(events[0].elapsedMs, 350);
  assert.equal(events[0].bytesDownloaded, 2048);
  assert.equal(events[1].audioSeconds, 600);
  assert.equal(events[1].estimatedUsd, 0.035);
  assert.equal(events[0].estimatedUsd, null);
});

test('archive metric preserves measured bytes and time without claiming an invoice charge', () => {
  const event = archiveUsageEvent('twitch:123', 'clip-id', 104857600, 25000);
  assert.equal(event.bytesWritten, 104857600);
  assert.equal(event.elapsedMs, 25000);
  assert.equal(event.estimatedStorageUsdFirstMonth, 0.00208);
  assert.equal(event.actualBilledUsd, null);
});
