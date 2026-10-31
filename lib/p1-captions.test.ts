import test from 'node:test';
import assert from 'node:assert/strict';
import { captionMotion, captionAssMotionAt } from './caption-template-motion.ts';
import { buildCaptionCues, generateTimedCueAss, layoutTimedCaption, captionAppearance } from './captions.ts';
import { CAPTION_STYLES } from './clips.ts';
import { freshTimelineDraft, validateClipEditDraft } from './clip-edit-draft.ts';
import type { SavedClip } from './clip-ui.ts';

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

test('rapid one-word animated captions can be saved without losing spoken words', () => {
  const words = [
    { text: 'right', start: 43810, end: 43810 },
    { text: 'so', start: 44050, end: 44080 },
    { text: 'fast', start: 44110, end: 44140 },
    { text: 'now', start: 44160, end: 44190 },
    { text: 'yes', start: 45970, end: 45990 },
  ];
  const clip = { id: 'clip', url: 'upload:fixture', title: 'Moment', start_seconds: 44, end_seconds: 46, words } as SavedClip;
  const cues = buildCaptionCues(words, 44000, 46000, 1).map((cue, i) => ({ id: `cue-${i}`, start_ms: cue.startMs + 44000, end_ms: cue.endMs + 44000, text: cue.text }));
  assert.equal(cues.map(cue => cue.text).join(' '), words.map(word => word.text).join(' '));
  assert.ok(cues.every(cue => cue.end_ms - cue.start_ms >= 100));
  assert.doesNotThrow(() => validateClipEditDraft({ ...freshTimelineDraft(clip), caption_style: 'KLYP', caption_cues: cues }, clip));
});
