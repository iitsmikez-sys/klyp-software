import assert from 'node:assert/strict';
import test from 'node:test';
import { moveForeground, resizeForeground } from './foreground-framing.ts';

test('pinch zoom clamps to safe limits and preserves pan', () => {
  assert.deepEqual(resizeForeground({scale:2,x:.2,y:.8},10),{scale:4,x:.2,y:.8});
  assert.deepEqual(resizeForeground({scale:2,x:.2,y:.8},.1),{scale:1,x:.2,y:.8});
});

test('dragging pans the sharp video within the frame', () => {
  const next=moveForeground({scale:2,x:.5,y:.5},100,0,{w:1080,h:1920},{w:1080,h:608});
  assert.ok(next.x<.5);
  assert.equal(next.y,.5);
  assert.deepEqual(moveForeground({scale:1,x:.5,y:.5},10000,-10000,{w:1080,h:1920},{w:1080,h:608}),{scale:1,x:.5,y:0});
});
