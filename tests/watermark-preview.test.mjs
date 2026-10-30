import test from 'node:test';
import assert from 'node:assert/strict';
import { drawWatermarkPreview, generateWatermarkAss, watermarkFilter } from '../lib/watermark.ts';

test('Free export types the credit, holds, then leaves a static wordmark', () => {
  const ass = generateWatermarkAss({ w: 1080, h: 1920 }, 8);
  assert.match(ass, /PlayResX: 1080\nPlayResY: 1920/);
  assert.match(ass, /\\pos\(234,673\)\\frz270/);
  assert.match(ass, /Created with klyp/);
  assert.match(ass, /0:00:03\.10,0:00:03\.80/);
  assert.match(ass, /0:00:03\.45,0:00:08\.00,Mark[^\n]*\\pos\(188,664\)[^\n]*\}klyp/);
  assert.doesNotMatch(ass, /klyp\.world/);
  assert.match(watermarkFilter('/tmp/klyp-ass/watermark.ass'), /subtitles='\/tmp\/klyp-ass\/watermark\.ass'/);
});

test('short exports have no invalid subtitle intervals', () => {
  const ass = generateWatermarkAss({ w: 1080, h: 1920 }, 1.2);
  assert.doesNotMatch(ass, /0:00:03/);
  assert.doesNotMatch(ass, /0:00:01\.20,0:00:01\.20/);
});

test('preview types then draws the static wordmark in the same place', () => {
  const calls = [];
  const ctx = {
    save(){}, restore(){}, scale(){}, translate(...a){ calls.push(['translate',...a]); },
    rotate(){}, fillText(...a){ calls.push(['text',...a]); },
  };
  drawWatermarkPreview(ctx, 1, 1080, 1920);
  drawWatermarkPreview(ctx, 4, 1080, 1920);
  assert.ok(calls.some(c => c[0] === 'translate' && c[1] === 233.9 && c[2] === 673));
  assert.ok(calls.some(c => c[0] === 'text' && c[1] === 'klyp' && c[2] === 188 && c[3] === 663.82));
});
