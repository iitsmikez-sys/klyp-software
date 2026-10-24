import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFrameSuggestion, readBoundedFrameBody, validateFrameSamples } from './auto-frame.ts';
const jpg = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0xff, 0xd9]).toString('base64');

test('rejects low-confidence or invalid AI boxes without moving the crop', () => {
  assert.equal(parseFrameSuggestion({ confidence: 0.6, gameplay: { x: .4, y: 0, w: .3, h: 1 } }), null);
  assert.equal(parseFrameSuggestion({ confidence: .9, gameplay: { x: -1, y: 0, w: .3, h: 1 } }), null);
});
test('valid stable boxes become a safe vertical layout', () => {
  assert.deepEqual(parseFrameSuggestion({ confidence: .8, gameplay: { x: .35, y: 0, w: .3, h: 1 }, facecam: { x: .72, y: .02, w: .2, h: .3 } }),
    { version: 1, gameplay: { x: .35, y: 0, w: .3, h: 1 }, facecam: { x: .72, y: .02, w: .2, h: .3 } });
});
test('sample requests are capped and require actual JPEG bytes', () => {
  assert.equal(validateFrameSamples([jpg]).length, 1);
  assert.throws(() => validateFrameSamples([jpg, jpg, jpg, jpg]));
  assert.throws(() => validateFrameSamples([Buffer.from('fake').toString('base64')]));
});
test('request body is bounded before parsing', async () => {
  const good = new Request('https://fixture.test', { method: 'POST', body: JSON.stringify({ frames: [jpg] }) });
  assert.deepEqual(await readBoundedFrameBody(good), { frames: [jpg] });
  const large = new Request('https://fixture.test', { method: 'POST', body: 'x'.repeat(1_100_001) });
  await assert.rejects(readBoundedFrameBody(large), /too large/i);
});
