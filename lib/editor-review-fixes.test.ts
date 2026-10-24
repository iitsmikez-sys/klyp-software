import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileSavedDraft, isEditorShortcutTarget } from './editor-session.ts';
test('server normalization replaces submitted visible snapshot', () => {
    const raw = { title: '  title  ', hook: ' hook ', caption_cues: [{ text: ' cue ' }] };
    const normalized = { title: 'title', hook: 'hook', caption_cues: [{ text: 'cue' }] };
    assert.deepEqual(reconcileSavedDraft(raw, raw, normalized), normalized);
});
test('save response normalizes unchanged fields without clobbering pending edits', () => {
    const submitted = { title: ' title ', hook: ' hook ', caption_cues: [{ text: ' cue ' }] };
    const current = { ...submitted, hook: 'new hook' };
    const saved = { title: 'title', hook: 'hook', caption_cues: [{ text: 'cue' }] };
    assert.deepEqual(reconcileSavedDraft(current, submitted, saved), { ...saved, hook: 'new hook' });
});
test('native interactive controls own their Space activation', () => {
    for (const tag of ['BUTTON', 'A', 'INPUT', 'TEXTAREA', 'SELECT'])
        assert.equal(isEditorShortcutTarget(tag, null, false), false);
    for (const role of ['button', 'tab', 'slider', 'link', 'menuitem'])
        assert.equal(isEditorShortcutTarget('DIV', role, false), false);
    assert.equal(isEditorShortcutTarget('DIV', null, true), false);
    assert.equal(isEditorShortcutTarget('DIV', null, false), true);
});

test('focused timeline buttons allow Delete, Backspace and undo/redo commands', () => {
    for (const command of ['Delete', 'Backspace', 'KeyZ']) {
        assert.equal(isEditorShortcutTarget('BUTTON', null, false, command), true);
        assert.equal(isEditorShortcutTarget('DIV', 'button', false, command), true);
    }
    assert.equal(isEditorShortcutTarget('BUTTON', null, false, 'Space'), false);
});
test('text editing controls keep their native edit shortcuts', () => {
    for (const command of ['Delete', 'Backspace', 'KeyZ', 'Space']) {
        for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
            assert.equal(isEditorShortcutTarget(tag, null, false, command), false);
        }
        assert.equal(isEditorShortcutTarget('DIV', 'textbox', false, command), false);
        assert.equal(isEditorShortcutTarget('SPAN', null, true, command), false);
    }
});
