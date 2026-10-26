import test from 'node:test';
import assert from 'node:assert/strict';
import { sameClipWindow } from './clip-access-core.ts';

test('raw moment access requires the exact analyzed window and source', () => {
  const allowed={source_key:'twitch:123',start_seconds:100.125,end_seconds:110.75};
  assert.equal(sameClipWindow({...allowed},allowed),true);
  assert.equal(sameClipWindow({...allowed,start_seconds:101},allowed),false);
  assert.equal(sameClipWindow({...allowed,end_seconds:109},allowed),false);
  assert.equal(sameClipWindow({...allowed,source_key:'twitch:other'},allowed),false);
});
