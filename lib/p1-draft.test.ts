import test from 'node:test';
import assert from 'node:assert/strict';
import { validateClipEditDraft } from './clip-edit-draft.ts';

const clip = { start_seconds: 10, end_seconds: 30, words: null };
const base = {
  version: 3, start_seconds: 10, end_seconds: 30, title: 'A moment', hook: '',
  hook_style: 'IMPACT', caption_style: 'BOLD', aspect_ratio: '9:16', words: null,
  segments: [{ id: 's1', start_seconds: 10, end_seconds: 30 }], caption_cues: null,
  caption_color: 'white', caption_position: 'bottom', cutaways: [],
};

test('old saved editor drafts get a safe caption font and audio default', () => {
  const draft = validateClipEditDraft(base, clip);
  assert.equal(draft.version, 3);
  if (draft.version !== 3) return;
  assert.equal(draft.caption_font, 'sans');
  assert.equal(draft.audio_polish, 'off');
});

test('caption font and audio polish are saved only from bounded choices', () => {
  const draft = validateClipEditDraft({ ...base, caption_font: 'mono', audio_polish: 'voice' }, clip);
  assert.equal(draft.version, 3);
  if (draft.version !== 3) return;
  assert.equal(draft.caption_font, 'mono');
  assert.equal(draft.audio_polish, 'voice');
  assert.throws(() => validateClipEditDraft({ ...base, caption_font: 'monospace;drop' }, clip), /caption font/i);
  assert.throws(() => validateClipEditDraft({ ...base, audio_polish: 'loudnorm;volume=20' }, clip), /audio polish/i);
});
