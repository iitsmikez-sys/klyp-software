import test from 'node:test';
import assert from 'node:assert/strict';
import { freshTimelineDraft } from './clip-edit-draft.ts';
import { buildCaptionCues, captionAppearance, generateTimedCueAss } from './captions.ts';
import { changeCaptionTemplate } from './editor-captions.ts';
import type { SavedClip } from './clip-ui.ts';

const clip = { id: 'clip', url: 'upload:test', title: 'Moment', start_seconds: 0, end_seconds: 4,
  words: [
    { text: 'That', start: 100, end: 350 }, { text: 'was', start: 400, end: 650 },
    { text: 'really', start: 700, end: 950 }, { text: 'wild', start: 1000, end: 1250 },
  ] } as SavedClip;
const automatic = (maxWords: number) => buildCaptionCues(clip.words!, 0, 4000, maxWords)
  .map((cue, index) => ({ id: `auto-${index}`, start_ms: cue.startMs, end_ms: cue.endMs, text: cue.text }));

test('switching to a word template regroups automatically generated captions', () => {
  const draft = { ...freshTimelineDraft(clip), caption_style: 'BOLD' as const, caption_cues: automatic(4) };
  const changed = changeCaptionTemplate(draft, clip, 'KLYP');
  assert.deepEqual(changed.caption_cues, automatic(1));
  assert.equal(changed.caption_style, 'KLYP');
  assert.equal(changed.caption_cues?.map(cue => cue.text).join(' '), 'That was really wild');
});

test('switching away from a word template restores phrase grouping', () => {
  const draft = { ...freshTimelineDraft(clip), caption_style: 'SPARK' as const, caption_cues: automatic(1) };
  assert.deepEqual(changeCaptionTemplate(draft, clip, 'CLEAN').caption_cues, automatic(4));
});

test('template changes preserve manually edited or absent captions', () => {
  const edited = { ...freshTimelineDraft(clip), caption_style: 'BOLD' as const,
    caption_cues: [{ ...automatic(4)[0], text: 'Custom punchline' }] };
  assert.deepEqual(changeCaptionTemplate(edited, clip, 'KLYP').caption_cues, edited.caption_cues);
  assert.deepEqual(changeCaptionTemplate(freshTimelineDraft(clip), clip, 'KLYP').caption_cues, []);
});

test('choosing branded templates applies the palette shown on their cards', () => {
  const base = freshTimelineDraft(clip);
  assert.equal(changeCaptionTemplate(base, clip, 'KLYP').caption_color, 'green');
  assert.equal(changeCaptionTemplate(base, clip, 'SPARK').caption_color, 'green');
  assert.equal(changeCaptionTemplate(base, clip, 'PULSE').caption_color, 'yellow');
  assert.equal(changeCaptionTemplate(base, clip, 'GLOW').caption_color, 'pink');
  assert.equal(changeCaptionTemplate(base, clip, 'BOLD').caption_color, 'white');
});

test('Glow export uses a soft luminous outline, not only plain pink text', () => {
  const ass = generateTimedCueAss([{ start_ms: 0, end_ms: 1000, text: 'THIS IS IT' }],
    'GLOW', captionAppearance({ caption_color: 'pink', caption_position: 'bottom' }));
  assert.match(ass, /\\blur\d+/);
  assert.match(ass, /\\3c&H00FF99FF&/);
});
