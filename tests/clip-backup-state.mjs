import assert from 'node:assert/strict';
import test from 'node:test';
import { backupState } from '../lib/clip-backup-state.ts';

test('a clip is confirmed saved only after its durable archive is stored', () => {
  for (const status of [undefined, null, 'none', 'pending', 'processing', 'failed', 'unavailable']) {
    assert.notEqual(backupState(status).kind, 'saved', String(status));
  }
  assert.equal(backupState('stored').kind, 'saved');
});

test('failed and unavailable backups are reported without a false saved claim', () => {
  assert.match(backupState('failed').message, /failed|not protected/i);
  assert.match(backupState('unavailable').message, /unavailable|not protected/i);
  assert.match(backupState('pending').message, /backup|backing/i);
  assert.match(backupState('unavailable', 'upload:123').message, /reupload/i);
});
