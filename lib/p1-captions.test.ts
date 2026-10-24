import test from 'node:test';
import assert from 'node:assert/strict';
import { captionMotion, captionAssMotionAt } from './caption-template-motion.ts';
import { generateTimedCueAss, layoutTimedCaption, captionAppearance } from './captions.ts';
import { CAPTION_STYLES } from './clips.ts';

const cue = [{ start_ms: 0, end_ms: 900, text: 'Make the moment count' }];
const appearance = captionAppearance({ caption_color: 'white', caption_position: 'bottom' });

test('original Bounce and Glow templates have distinct preview and export motion', () => {
  assert.ok(CAPTION_STYLES.includes('BOUNCE'));
  assert.ok(CAPTION_STYLES.includes('GLOW'));
  assert.deepEqual(captionMotion('BOUNCE', 0), { scale: 0.58, yOffset: 0, alpha: 0 });
  assert.equal(captionMotion('BOUNCE', 110).scale, 1.1);
  assert.equal(captionMotion('BOUNCE', 250).scale, 1);
  assert.match(captionAssMotionAt('BOUNCE', 540, 1500, 1920), /\\fscx58.*\\t\(0,110,\\fscx110/);
  assert.match(captionAssMotionAt('GLOW', 540, 1500, 1920), /\\fad\(180,0\)/);
});

test('curated caption font appears in ASS and the canvas layout', () => {
  const ass = generateTimedCueAss(cue, 'BOUNCE', appearance, { w: 1080, h: 1920 }, undefined, 'mono');
  assert.match(ass, /Style: Default,DejaVu Sans Mono,/);
  const layout = layoutTimedCaption(cue[0].text, 'BOUNCE', appearance, undefined, undefined, 'mono');
  assert.equal(layout.fontFamily, '"DejaVu Sans Mono", monospace');
  assert.doesNotMatch(ass, /Arial,/);
});
