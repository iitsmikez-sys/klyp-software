import test from 'node:test';
import assert from 'node:assert/strict';
import { seekEditedVideo, nextPlaybackPosition, nextComposedPlaybackPosition, thumbnailTimes, audioPeaks, timeToPixels } from './editor-preview.ts';
const segments = [{id:'a',start_seconds:100,end_seconds:102},{id:'b',start_seconds:105,end_seconds:108}];
test('seeks output to preview local time with original envelope origin',()=>{const video={currentTime:0};seekEditedVideo(video,segments,3,99);assert.equal(video.currentTime,7);});
test('skips deleted span and preserves output clock',()=>{assert.deepEqual(nextPlaybackPosition(segments,103),{sourceSeconds:105,outputSeconds:2,ended:false});});
test('pauses at clip end',()=>{assert.deepEqual(nextPlaybackPosition(segments,109),{sourceSeconds:108,outputSeconds:5,ended:true});});
test('selects actual kept frame timestamps',()=>{assert.deepEqual(thumbnailTimes(segments,5),[100,101,105,106,107]);});
test('missing and silent media have no invented waveform',()=>{assert.equal(audioPeaks(null,4),null);assert.equal(audioPeaks(new Float32Array(8),4),null);assert.deepEqual(audioPeaks(new Float32Array([0,.5,-1,0]),2),[.5,1]);});
test('timeline scales proportionally at two zoom levels',()=>{assert.equal(timeToPixels(2,40,1),80);assert.equal(timeToPixels(2,40,2),160);});
test('source playback stops at an insertion once, then resumes the next source section',()=>{
 const insert={id:'media',asset_id:'asset',after_segment_id:'a',duration_ms:1000,asset_in_ms:0,muted:false};
 const draft={segments:[{id:'a',start_seconds:100,end_seconds:101},{id:'b',start_seconds:101,end_seconds:102}],inserts:[insert]};
 assert.deepEqual(nextComposedPlaybackPosition(draft,101.02,.95),{sourceSeconds:101,outputSeconds:1,insertId:'media',ended:false});
 const after=nextComposedPlaybackPosition(draft,101.02,2.01);assert.equal(after.insertId,null);assert.ok(Math.abs(after.outputSeconds-2.02)<1e-6);
});
