import assert from 'node:assert/strict';
import test from 'node:test';
import { backupState, backupTone } from '../lib/clip-backup-state.ts';

test('a clip is confirmed saved only after its durable archive is stored', () => {
  for (const status of [undefined, null, 'none', 'pending', 'processing', 'failed', 'unavailable']) {
    assert.notEqual(backupState(status).kind, 'saved', String(status));
  }
  assert.equal(backupState('stored').kind, 'saved');
});

test('failed and unavailable backups are reported without a false saved claim', () => {
  assert.match(backupState('failed').message, /not backed up/i, 'still honest: it says the clip is not backed up');
  assert.doesNotMatch(backupState('failed').message, /failed|not protected/i, 'but no alarm words');
  assert.match(backupState('unavailable').message, /unavailable|not protected/i);
  assert.match(backupState('pending').message, /saving/i);
  assert.match(backupState('unavailable', 'upload:123').message, /reupload/i);
});

test('only a saved clip is green and only truly gone footage gets the warning colour', () => {
  assert.equal(backupTone(backupState('stored').kind), 'good');
  for (const status of ['failed', 'pending', 'processing', undefined]) assert.equal(backupTone(backupState(status).kind), 'quiet', String(status));
  for (const status of ['unavailable', 'expired']) assert.equal(backupTone(backupState(status).kind), 'warn', status);
});
