import assert from 'node:assert/strict';
import test from 'node:test';
import { focusAtOutputTime, layoutForFocus, resolveFocusSpans, setFocusAtOutputTime, splitCuesForFocus, suggestFocusEvents, validateFocusEvents } from './editor-focus.ts';

const segments = [
  { id: 'a', start_seconds: 100, end_seconds: 104 },
  { id: 'b', start_seconds: 108, end_seconds: 112 },
];
const base = { version: 1 as const, gameplay: { x: .25, y: 0, w: .75, h: 1 }, facecam: { x: 0, y: 0, w: .25, h: .5 }, arrangement: 'facecam_top' as const };

test('focus markers validate source bounds, ordering, IDs, and limit', () => {
  assert.deepEqual(validateFocusEvents([{ id: 'r', source_ms: 102000, mode: 'reaction' }], 100, 112), [{ id: 'r', source_ms: 102000, mode: 'reaction' }]);
  for (const invalid of [
    [{ id: 'r', source_ms: 99000, mode: 'reaction' }],
    [{ id: 'r', source_ms: 112000, mode: 'reaction' }],
    [{ id: 'r', source_ms: NaN, mode: 'reaction' }],
    [{ id: 'r', source_ms: 102000, mode: 'other' }],
    [{ id: 'r', source_ms: 102000, mode: 'reaction' }, { id: 'r', source_ms: 103000, mode: 'gameplay' }],
    Array.from({ length: 13 }, (_, i) => ({ id: `e${i}`, source_ms: 100000 + i * 500, mode: 'reaction' })),
  ]) assert.throws(() => validateFocusEvents(invalid, 100, 112));
});

test('source markers follow kept footage while deleted moments do not switch focus', () => {
  const markers = validateFocusEvents([
    { id: 'r', source_ms: 102000, mode: 'reaction' },
    { id: 'removed', source_ms: 106000, mode: 'reaction' },
    { id: 'g', source_ms: 109000, mode: 'gameplay' },
  ], 100, 112);
  const spans = resolveFocusSpans(markers, segments);
  assert.deepEqual(spans.map(s => [s.start_ms, s.end_ms, s.mode]), [
    [0, 2000, 'gameplay'], [2000, 5000, 'reaction'], [5000, 8000, 'gameplay'],
  ]);
  assert.equal(focusAtOutputTime(spans, 1.999), 'gameplay');
  assert.equal(focusAtOutputTime(spans, 2), 'reaction');
  assert.equal(focusAtOutputTime(spans, 5), 'gameplay');
});

test('reaction enlarges facecam and hides chat without changing saved source boxes', () => {
  const original = { ...base, chat: { x: .75, y: 0, w: .25, h: 1 } };
  const reaction = layoutForFocus(original, 'reaction');
  assert.equal(reaction?.focus, 'reaction');
  assert.equal(reaction?.arrangement, 'facecam_top');
  assert.equal(reaction?.chat, undefined);
  assert.deepEqual(original.chat, { x: .75, y: 0, w: .25, h: 1 });
  assert.equal(layoutForFocus(null, 'reaction'), null);
  assert.equal(layoutForFocus({ version: 1, gameplay: base.gameplay }, 'reaction')?.focus, undefined);
});

test('suggestions pair a loud reaction with a return to gameplay for review', () => {
  const peaks = Array(80).fill(.08); peaks[20] = .95;
  const suggestions = suggestFocusEvents(segments, peaks, []);
  assert.equal(suggestions.length, 2);
  assert.equal(suggestions[0].mode, 'reaction');
  assert.equal(suggestions[1].mode, 'gameplay');
  assert.ok(suggestions[1].source_ms > suggestions[0].source_ms);
  assert.deepEqual(suggestFocusEvents(segments, null, []), []);
});

test('a caption crossing a switch is split so each half can use its active safe area', () => {
 const result=splitCuesForFocus([{id:'cue',start_ms:500,end_ms:1500,text:'WHAT A PLAY'}],[{start_ms:0,end_ms:1000,mode:'gameplay'},{start_ms:1000,end_ms:2000,mode:'reaction'}]);
 assert.deepEqual(result.map(c=>[c.start_ms,c.end_ms,c.mode]),[[500,1000,'gameplay'],[1000,1500,'reaction']]);
});

test('adding focus at the playhead replaces a nearby marker and rejects the end position', () => {
 const first=setFocusAtOutputTime([],segments,0, 'reaction','a',100,112);
 assert.deepEqual(first,[{id:'a',source_ms:100000,mode:'reaction'}]);
 const replacement=setFocusAtOutputTime(first,segments,.1,'gameplay','b',100,112);
 assert.deepEqual(replacement,[{id:'b',source_ms:100100,mode:'gameplay'}]);
 assert.throws(()=>setFocusAtOutputTime(first,segments,8,'reaction','c',100,112),/playhead/i);
});
