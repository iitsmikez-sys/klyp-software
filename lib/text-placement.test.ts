import assert from 'node:assert/strict';
import test from 'node:test';
import { moveTextPlacement, resizeTextPlacement, validateTextPlacement } from './text-placement.ts';

test('text placement validates bounded positions and size', () => {
  assert.deepEqual(validateTextPlacement({x:.3,y:.7,scale:1.5}),{x:.3,y:.7,scale:1.5});
  for(const value of [{x:-.1,y:.5,scale:1},{x:.5,y:1.1,scale:1},{x:.5,y:.5,scale:0},{x:NaN,y:.5,scale:1}])
    assert.throws(()=>validateTextPlacement(value),/placement/i);
});

test('drag and pinch stay inside the safe canvas and size limits', () => {
  assert.deepEqual(moveTextPlacement({x:.5,y:.5,scale:1},.2,-.1),{x:.7,y:.4,scale:1});
  assert.deepEqual(moveTextPlacement({x:.5,y:.5,scale:1},10,-10),{x:.95,y:.05,scale:1});
  assert.deepEqual(resizeTextPlacement({x:.5,y:.5,scale:1},4),{x:.5,y:.5,scale:2.5});
});
