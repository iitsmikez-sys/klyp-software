import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKeptSegmentsFilter } from './editor-render.ts';

const segments = [{ id: 'a', start_seconds: 0, end_seconds: 2 }];
test('voice polish applies a bounded filter after segment joins', () => {
  const graph = buildKeptSegmentsFilter(0, segments, true, 'voice');
  assert.match(graph, /\[audio\]highpass=f=80,lowpass=f=12000,acompressor=/);
  assert.match(graph, /\[audio_polished\]$/);
});
test('off and silent inputs avoid audio enhancement', () => {
  assert.doesNotMatch(buildKeptSegmentsFilter(0, segments, true, 'off'), /acompressor/);
  assert.doesNotMatch(buildKeptSegmentsFilter(0, segments, false, 'voice'), /acompressor/);
});
