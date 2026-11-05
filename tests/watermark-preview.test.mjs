import test from 'node:test';
import assert from 'node:assert/strict';
import { drawWatermarkPreview, generateWatermarkAss, watermarkFilter } from '../lib/watermark.ts';

const bs = String.fromCharCode(92);
const rowsOf = (ass) => ass.split('\n').filter((l) => l.startsWith('Dialogue:'));

test('Free export types the credit, holds, then folds into a small logo word (kl white, yp green)', () => {
  const ass = generateWatermarkAss({ w: 1080, h: 1920 }, 8);
  assert.match(ass, /PlayResX: 1080\nPlayResY: 1920/);
  const rows = rowsOf(ass);
  // 21 typed letters + the fold + the small mark.
  assert.equal(rows.length, 23);
  assert.match(rows[0], /^Dialogue: 0,0:00:00\.00,0:00:00\.09,Mark[^\n]*\\pos\(234,673\)\\frz270\}\{\\1c&HFFFFFF&\}C$/);
  assert.ok(rows[20].includes('Created by '));
  assert.match(rows[20], /^Dialogue: 0,0:00:01\.82,0:00:03\.10,Mark/);
  // Logo colors: "kl" white, "yp" green (#00E5A0), the rest white.
  assert.ok(rows[20].includes(`{${bs}1c&HFFFFFF&}kl{${bs}1c&HA0E500&}yp{${bs}1c&HFFFFFF&}.world`));
  assert.doesNotMatch(ass, /Created with/);
  // The fold and the small mark keep the original timing.
  assert.match(ass, /0:00:03\.10,0:00:03\.80/);
  assert.ok(rows[21].includes(`${bs}fscx8${bs}alpha&HFF&`));
  assert.match(rows[22], /^Dialogue: 0,0:00:03\.45,0:00:08\.00,Mark[^\n]*\\pos\(188,664\)\\fad\(350,0\)\}\{\\1c&HFFFFFF&\}kl\{\\1c&HA0E500&\}yp$/);
  // No sliding: nothing uses \move.
  assert.ok(!ass.includes(`${bs}move`));
  assert.match(watermarkFilter('/tmp/klyp-ass/watermark.ass'), /subtitles='\/tmp\/klyp-ass\/watermark\.ass'/);
});

test('letters appear one at a time, each part keeping its color', () => {
  const rows = rowsOf(generateWatermarkAss({ w: 1080, h: 1920 }, 8));
  // The 13th letter is the "l" of "kl"; the 14th is the first green letter.
  assert.ok(rows[13].endsWith(`{${bs}1c&HFFFFFF&}kl{${bs}1c&HA0E500&}y`), rows[13]);
  assert.ok(rows[14].endsWith(`{${bs}1c&HA0E500&}yp`), rows[14]);
});

test('short exports have no invalid subtitle intervals', () => {
  const ass = generateWatermarkAss({ w: 1080, h: 1920 }, 1.2);
  assert.doesNotMatch(ass, /0:00:03/);
  assert.doesNotMatch(ass, /0:00:01\.20,0:00:01\.20/);
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

test('preview types in the logo colors, then draws the small logo word in the same place', () => {
  const typing = fakeCtx();
  drawWatermarkPreview(typing, 1.2, 1080, 1920);
  const typed = typing.calls.filter((c) => c[0] === 'text');
  assert.equal(typed.map((c) => c[3]).join(''), 'Created by kly');
  assert.deepEqual(typed.map((c) => c[1]), ['#FFFFFF', '#FFFFFF', '#00E5A0']);
  assert.ok(typing.calls.some((c) => c[0] === 'translate' && c[1] === 233.9 && c[2] === 673));

  const done = fakeCtx();
  drawWatermarkPreview(done, 2.5, 1080, 1920);
  assert.deepEqual(done.calls.filter((c) => c[0] === 'text').map((c) => c[3]), ['Created by ', 'kl', 'yp', '.world']);

  const late = fakeCtx();
  drawWatermarkPreview(late, 4, 1080, 1920);
  const mark = late.calls.filter((c) => c[0] === 'text');
  assert.deepEqual(mark.map((c) => c[3]), ['kl', 'yp']);
  assert.deepEqual(mark.map((c) => c[1]), ['#FFFFFF', '#00E5A0']);
  assert.ok(late.calls.some((c) => c[0] === 'translate' && c[1] === 188 && c[2] === 663.82));
});

test('during the fold the credit shrinks away while the small logo word fades in', () => {
  const ctx = fakeCtx();
  drawWatermarkPreview(ctx, 3.5, 1080, 1920);
  const texts = ctx.calls.filter((c) => c[0] === 'text');
  assert.ok(texts.some((c) => c[3] === 'Created by '));
  assert.ok(texts.some((c) => c[3] === 'kl' && c[2] > 0 && c[2] < .92));
});
