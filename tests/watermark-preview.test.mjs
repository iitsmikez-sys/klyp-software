import test from 'node:test';
import assert from 'node:assert/strict';
import { drawWatermarkPreview, generateWatermarkAss, watermarkFilter } from '../lib/watermark.ts';

const bs = String.fromCharCode(92);

test('Free export slides the credit in, holds, then slides in a small logo word', () => {
  const ass = generateWatermarkAss({ w: 1080, h: 1920 }, 8);
  assert.match(ass, /PlayResX: 1080\nPlayResY: 1920/);
  const rows = ass.split('\n').filter((l) => l.startsWith('Dialogue:'));
  assert.equal(rows.length, 2, 'one credit and one small mark, no typing');
  // The credit: rotated, slides from off the left edge to its place in 0.45s, fades out at 3.5s.
  assert.match(rows[0], /^Dialogue: 0,0:00:00\.00,0:00:03\.50,Mark/);
  assert.match(rows[0], /\\frz270\\move\(-65,673,234,673,0,450\)\\fad\(300,400\)/);
  assert.ok(rows[0].includes('Created by '));
  // Logo colors: "kl" white, "yp" green (#00E5A0), the rest white.
  assert.ok(rows[0].includes(`{${bs}1c&HFFFFFF&}kl{${bs}1c&HA0E500&}yp{${bs}1c&HFFFFFF&}.world`));
  assert.doesNotMatch(ass, /Created with/);
  // The small mark slides in from the left while the credit is leaving, and stays to the end.
  assert.match(rows[1], /^Dialogue: 0,0:00:03\.30,0:00:08\.00,Mark/);
  assert.match(rows[1], /\\move\(150,664,188,664,0,350\)\\fad\(350,0\)/);
  assert.ok(rows[1].includes(`{${bs}1c&HFFFFFF&}kl{${bs}1c&HA0E500&}yp`));
  assert.match(watermarkFilter('/tmp/klyp-ass/watermark.ass'), /subtitles='\/tmp\/klyp-ass\/watermark\.ass'/);
});

test('short exports have no invalid subtitle intervals', () => {
  const ass = generateWatermarkAss({ w: 1080, h: 1920 }, 1.2);
  assert.doesNotMatch(ass, /0:00:03/);
  assert.doesNotMatch(ass, /0:00:01\.20,0:00:01\.20/);
  assert.equal(ass.split('\n').filter((l) => l.startsWith('Dialogue:')).length, 1);
});

function fakeCtx() {
  const calls = [];
  const ctx = {
    calls,
    save(){}, restore(){}, scale(){}, rotate(){},
    translate(...a){ calls.push(['translate', ...a]); },
    measureText(text){ return { width: text.length * 10 }; },
    fillText(...a){ calls.push(['text', ctx.fillStyle, ctx.globalAlpha, ...a]); },
  };
  return ctx;
}

test('preview slides the credit in with the logo colors, then shows the small logo word in the same place', () => {
  const ctx = fakeCtx();
  drawWatermarkPreview(ctx, 1, 1080, 1920);
  const credit = ctx.calls.filter((c) => c[0] === 'text');
  assert.deepEqual(credit.map((c) => c[3]), ['Created by ', 'kl', 'yp', '.world']);
  assert.deepEqual(credit.map((c) => c[1]), ['#FFFFFF', '#FFFFFF', '#00E5A0', '#FFFFFF']);
  // After the slide the credit sits at its home spot.
  assert.ok(ctx.calls.some((c) => c[0] === 'translate' && c[1] === 233.9 && c[2] === 673));
  // Before it finishes sliding it is further left.
  const early = fakeCtx();
  drawWatermarkPreview(early, 0.1, 1080, 1920);
  assert.ok(early.calls.find((c) => c[0] === 'translate')[1] < 233.9);

  const late = fakeCtx();
  drawWatermarkPreview(late, 4, 1080, 1920);
  const mark = late.calls.filter((c) => c[0] === 'text');
  assert.deepEqual(mark.map((c) => c[3]), ['kl', 'yp']);
  assert.deepEqual(mark.map((c) => c[1]), ['#FFFFFF', '#00E5A0']);
  assert.ok(late.calls.some((c) => c[0] === 'translate' && c[1] === 188 && c[2] === 663.82));
});

test('the credit is gone and the small mark is solid after the hand-off', () => {
  const ctx = fakeCtx();
  drawWatermarkPreview(ctx, 5, 1080, 1920);
  assert.ok(!ctx.calls.some((c) => c[0] === 'text' && c[3] === 'Created by '));
  assert.ok(ctx.calls.filter((c) => c[0] === 'text').every((c) => Math.abs(c[2] - .92) < 1e-9));
});
