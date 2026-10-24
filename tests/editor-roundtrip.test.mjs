import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultClipEditDraft, readClipEditDraft, upgradeClipEditDraft, validateClipEditDraft, toClipExportPayload } from '../lib/clip-edit-draft.ts';
import { splitSegment, deleteSegment, outputDuration } from '../lib/editor-timeline.ts';
import { trimSelected } from '../lib/editor-session.ts';
import { resolveEditorCues, editorOverlayAtTime } from '../lib/editor-captions.ts';
import { validateEditorExportRequest } from '../lib/editor-render.ts';

test('saved V1 upgrades, edits, and JSON reload preserve preview/export timing and source captions', () => {
  const clip = {
    id: 'owned', url: 'https://twitch.tv/videos/1', title: 'Original',
    start_seconds: 100, end_seconds: 110,
    words: [{ text: 'original', start: 101000, end: 101600 }],
  };
  clip.edit_draft = { ...defaultClipEditDraft(clip), title: 'Legacy correction' };
  const loaded = readClipEditDraft(clip);
  assert.equal(loaded.unsupportedVersion, false);
  let draft = upgradeClipEditDraft(clip, loaded.draft);
  assert.equal(draft.title, 'Legacy correction');
  let segments = splitSegment(draft.segments, 'segment-1', 104);
  segments = splitSegment(segments, segments[1].id, 106);
  segments = deleteSegment(segments, segments[1].id);
  segments = trimSelected(segments, segments[0].id, 101, 104, 100, 110);
  draft = {
    ...draft, segments, start_seconds: 101, end_seconds: 110,
    title: ' Saved title ', hook: ' Keep watching ', caption_style: 'CLEAN',
    caption_color: 'yellow', caption_position: 'top',
    caption_cues: [
      { id: 'corrected', start_ms: 101000, end_ms: 102000, text: ' corrected text ' },
      { id: 'removed-span', start_ms: 104000, end_ms: 106000, text: 'hidden' },
      { id: 'later', start_ms: 107000, end_ms: 108000, text: 'later' },
    ],
  };
  const saved = validateClipEditDraft(draft, clip);
  const reloaded = readClipEditDraft({ ...clip, edit_draft: JSON.parse(JSON.stringify(saved)) });
  assert.equal(reloaded.unsupportedVersion, false);
  assert.deepEqual(reloaded.draft, saved);
  assert.deepEqual(saved.words, clip.words);
  assert.equal(saved.title, 'Saved title');
  assert.equal(saved.hook, 'Keep watching');
  assert.equal(outputDuration(saved.segments), 7);
  assert.deepEqual(resolveEditorCues(saved, clip).map(({ text, start_ms, end_ms }) => ({ text, start_ms, end_ms })), [
    { text: 'corrected text', start_ms: 0, end_ms: 1000 },
    { text: 'later', start_ms: 4000, end_ms: 5000 },
  ]);
  assert.equal(editorOverlayAtTime(saved, clip, 4.5).caption.text, 'later');
  const exported = validateEditorExportRequest(JSON.parse(JSON.stringify(toClipExportPayload(clip, saved))), clip);
  assert.deepEqual(exported, saved);
  assert.equal(exported.caption_color, 'yellow');
  assert.equal(exported.caption_position, 'top');
});
