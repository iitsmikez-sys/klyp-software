import test from 'node:test';
import assert from 'node:assert/strict';
import { initialSavedEditorState } from '../lib/editor-compatibility.ts';

test('saved device edits remain accessible while Edit starts in the timeline', () => {
  const oldDraft = JSON.stringify({ segments: [{ start: 1, end: 4 }], hook: 'Keep this edit' });
  assert.deepEqual(initialSavedEditorState(oldDraft), { mode: 'timeline', hasLegacy: true });
  assert.deepEqual(initialSavedEditorState(null), { mode: 'timeline', hasLegacy: false });
  assert.equal(JSON.parse(oldDraft).hook, 'Keep this edit');
});

