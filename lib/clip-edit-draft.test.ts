import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultClipEditDraft,
  readClipEditDraft,
  toClipExportPayload,
  validateClipEditDraft,
} from "./clip-edit-draft.ts";
import type { SavedClip } from "./clip-ui.ts";

test("layout override validates, exports, and old drafts remain valid", () => {
  const layout = { version: 1, gameplay: { x: 0, y: 0, w: 1, h: 1 } };
  const checked = validateClipEditDraft(draft({ vertical_layout: layout }), clip);
  assert.deepEqual(toClipExportPayload(clip, checked).vertical_layout, layout);
  assert.equal(validateClipEditDraft(draft(), clip).vertical_layout, undefined);
  assert.equal(Object.hasOwn(validateClipEditDraft(draft({ vertical_layout: undefined }), clip), "vertical_layout"), false);
  assert.throws(() => validateClipEditDraft(draft({ vertical_layout: { version: 1, gameplay: { x: 0.9, y: 0, w: 1, h: 1 } } }), clip));
});

test("facecam-first layout survives draft validation and export", () => {
  const layout = { version: 1, gameplay: { x: 0.2, y: 0, w: 0.8, h: 1 }, facecam: { x: 0, y: 0, w: 0.25, h: 0.4 }, arrangement: "facecam_top" };
  const checked = validateClipEditDraft(draft({ vertical_layout: layout }), clip);
  assert.deepEqual(toClipExportPayload(clip, checked).vertical_layout, layout);
});

const clip: SavedClip = {
  id: "clip-1", url: "https://www.twitch.tv/videos/1", title: "Original",
  clip_type: "FUNNY", viral_score: 80, caption: null, reason: null,
  start_seconds: 100, end_seconds: 130, created_at: "2026-10-22T00:00:00Z",
  words: [
    { text: "that", start: 101000, end: 101400 },
    { text: "worked", start: 101450, end: 102000 },
  ],
};

function draft(overrides: Record<string, unknown> = {}) {
  return {
    version: 1, start_seconds: 102, end_seconds: 128,
    title: "Edited", hook: "NO WAY", hook_style: "IMPACT",
    caption_style: "BOLD", aspect_ratio: "9:16",
    words: [{ text: "this", start: 101000, end: 101400 }, { text: "worked", start: 101450, end: 102000 }],
    ...overrides,
  };
}

test("valid text correction retains original word timing", () => {
  const result = validateClipEditDraft(draft(), clip);
  assert.equal(result.words?.[0].text, "this");
  assert.equal(result.words?.[0].start, 101000);
});

test("trim must stay inside original and last at most 180 seconds", () => {
  for (const range of [
    { start_seconds: 100, end_seconds: 100 },
    { start_seconds: 99, end_seconds: 120 },
    { start_seconds: 105, end_seconds: 131 },
  ]) assert.throws(() => validateClipEditDraft(draft(range), clip));
  const longClip = { ...clip, end_seconds: 400 };
  assert.throws(() => validateClipEditDraft(draft({ start_seconds: 100, end_seconds: 281 }), longClip));
  assert.equal(validateClipEditDraft(draft({ start_seconds: 100, end_seconds: 130 }), clip).end_seconds, 130);
});

test("unknown styles, format, title and hook limits fail", () => {
  for (const bad of [
    { hook_style: "SHADOW" }, { caption_style: "RAINBOW" }, { aspect_ratio: "4:3" },
    { title: "  " }, { title: "x".repeat(121) }, { hook: "x".repeat(81) },
  ]) assert.throws(() => validateClipEditDraft(draft(bad), clip));
});

test("caption correction may change text but never timestamps or word count", () => {
  assert.throws(() => validateClipEditDraft(draft({ words: [{ text: "this", start: 101001, end: 101400 }, clip.words![1]] }), clip));
  assert.throws(() => validateClipEditDraft(draft({ words: [clip.words![0]] }), clip));
  assert.throws(() => validateClipEditDraft(draft({ words: null }), clip));
});

test("legacy no-word clip keeps trim, title, and hook", () => {
  const oldClip = { ...clip, words: null };
  const result = validateClipEditDraft(draft({ words: null }), oldClip);
  assert.equal(result.words, null);
  assert.equal(result.hook, "NO WAY");
});

test("silent clip with an empty words array saves and exports without captions", () => {
  const silentClip = { ...clip, words: [] };
  const initial = defaultClipEditDraft(silentClip);
  assert.equal(initial.words, null);
  const checked = validateClipEditDraft(initial, silentClip);
  assert.equal(toClipExportPayload(silentClip, checked).style, undefined);
});

test("unknown draft version falls back to original with warning", () => {
  const future = { ...clip, edit_draft: { ...draft(), version: 2 } };
  const result = readClipEditDraft(future);
  assert.equal(result.unsupportedVersion, true);
  assert.deepEqual(result.draft, defaultClipEditDraft(clip));
});

test("export uses edited range and text plus archived clip id", () => {
  const payload = toClipExportPayload(clip, validateClipEditDraft(draft(), clip));
  assert.equal(payload.clip_id, "clip-1");
  assert.equal(payload.start_seconds, 102);
  assert.equal(payload.end_seconds, 128);
  assert.equal(payload.title, "Edited");
  assert.equal(payload.hook, "NO WAY");
  assert.equal(payload.words?.[0].text, "this");
  assert.equal(payload.style, "BOLD");
});

test("old clip export omits caption timing but retains trim and hook", () => {
  const oldClip = { ...clip, words: null };
  const payload = toClipExportPayload(oldClip, validateClipEditDraft(draft({ words: null }), oldClip));
  assert.equal(payload.words, undefined);
  assert.equal(payload.style, undefined);
  assert.equal(payload.hook, "NO WAY");
});

test("V1 upgrades preserving corrected text and layout", async () => {
  const { upgradeClipEditDraft } = await import("./clip-edit-draft.ts");
  const layout = { version: 1, gameplay: { x: 0, y: 0, w: 1, h: 1 } };
  const upgraded = upgradeClipEditDraft(clip, validateClipEditDraft(draft({ vertical_layout: layout }), clip));
  assert.equal(upgraded.version, 3);
  assert.equal(upgraded.words?.[0].text, "this");
  assert.deepEqual(upgraded.vertical_layout, layout);
  assert.deepEqual(upgraded.segments.map(({ start_seconds, end_seconds }) => [start_seconds, end_seconds]), [[102, 128]]);
  assert.equal(upgraded.caption_cues, null);
});
function v2(overrides: Record<string, unknown> = {}) {
  return { ...draft(), version: 2, start_seconds: 100, end_seconds: 130, segments: [{ id: "a", start_seconds: 100, end_seconds: 110 }, { id: "b", start_seconds: 120, end_seconds: 130 }], caption_cues: [{ id: "cue", start_ms: 108000, end_ms: 122000, text: "hello" }], caption_color: "white", caption_position: "bottom", ...overrides };
}
test("V2 validates original bounds and exports segment and cue choices", () => {
  const checked = validateClipEditDraft(v2(), clip);
  assert.equal(checked.version, 2);
  const payload = toClipExportPayload(clip, checked);
  assert.deepEqual(payload.segments, v2().segments);
  assert.deepEqual(payload.caption_cues, v2().caption_cues);
});
test("V2 rejects invalid segments, limits, cues and appearance", () => {
  for (const bad of [
    { segments: [] },
    { segments: [{ id: "a", start_seconds: 110, end_seconds: 100 }] },
    { segments: [{ id: "a", start_seconds: 99, end_seconds: 110 }] },
    { segments: [{ id: "a", start_seconds: 100, end_seconds: 120 }, { id: "b", start_seconds: 119, end_seconds: 130 }] },
    { segments: [{ id: "a", start_seconds: 120, end_seconds: 130 }, { id: "b", start_seconds: 100, end_seconds: 110 }] },
    { segments: [{ id: "a", start_seconds: 100, end_seconds: 110 }, { id: "a", start_seconds: 120, end_seconds: 130 }] },
    { caption_color: "red" }, { caption_position: "left" },
    { caption_cues: [{ id: "x", start_ms: 100000, end_ms: 100099, text: "short" }] },
    { caption_cues: [{ id: "x", start_ms: 99000, end_ms: 101000, text: "outside" }] },
    { caption_cues: [{ id: "x", start_ms: 100000, end_ms: 101000, text: " " }] },
    { caption_cues: Array.from({ length: 401 }, (_, i) => ({ id: String(i), start_ms: 100000, end_ms: 101000, text: "x" })) },
  ]) assert.throws(() => validateClipEditDraft(v2(bad), clip));
  assert.throws(() => validateClipEditDraft(v2({ start_seconds: 100, end_seconds: 400, segments: [{ id: "x", start_seconds: 100, end_seconds: 400 }] }), { ...clip, end_seconds: 400 }));
});

test("V2 permits long envelopes with short output and enforces exact envelope", () => {
  const source = { ...clip, end_seconds: 400 };
  const input = v2({ end_seconds: 400, segments: [{ id: "a", start_seconds: 100, end_seconds: 110 }, { id: "b", start_seconds: 390, end_seconds: 400 }] });
  assert.equal(validateClipEditDraft(input, source).end_seconds, 400);
  assert.throws(() => validateClipEditDraft({ ...input, end_seconds: 399 }, source));
});
test("V2 enforces item counts, unique cue ids, finite time and text limits", () => {
  for (const bad of [
    { segments: Array.from({ length: 65 }, (_, i) => ({ id: String(i), start_seconds: 100 + i / 5, end_seconds: 100.1 + i / 5 })) },
    { segments: [{ id: "x", start_seconds: NaN, end_seconds: 130 }] },
    { segments: [{ id: "x", start_seconds: 100, end_seconds: Infinity }] },
    { caption_cues: [{ id: "x", start_ms: 100000, end_ms: 101000, text: "a" }, { id: "x", start_ms: 101000, end_ms: 102000, text: "b" }] },
    { caption_cues: [{ id: "x", start_ms: NaN, end_ms: 101000, text: "a" }] },
    { caption_cues: [{ id: "x", start_ms: 100000, end_ms: 101000, text: "a".repeat(1001) }] },
  ]) assert.throws(() => validateClipEditDraft(v2(bad), clip));
  assert.equal(validateClipEditDraft(v2({ caption_cues: [] }), clip).version, 2);
});

test("V2 caption overrides export their preset even without original words", () => {
  const silent = { ...clip, words: null };
  const checked = validateClipEditDraft(v2({ words: null }), silent);
  assert.equal(toClipExportPayload(silent, checked).style, "BOLD");
  assert.equal(readClipEditDraft({ ...clip, edit_draft: v2() }).unsupportedVersion, false);
});

test('V2 export transports the complete unsaved draft losslessly', () => {
 const checked = validateClipEditDraft(v2(), clip);
 assert.deepEqual(toClipExportPayload(clip, checked).edit_draft, checked);
});

test('V3 preserves bounded focus changes in saved drafts and exports', async () => {
 const {upgradeClipEditDraft} = await import('./clip-edit-draft.ts');
 const current = upgradeClipEditDraft(clip, validateClipEditDraft(v2(), clip));
 const events = [{id:'reaction',source_ms:102000,mode:'reaction'},{id:'game',source_ms:105000,mode:'gameplay'}];
 const checked = validateClipEditDraft({...current,focus_events:events},clip);
 assert.deepEqual(checked.version===3?checked.focus_events:null,events);
 assert.deepEqual(toClipExportPayload(clip,checked).edit_draft,checked);
 assert.equal(upgradeClipEditDraft(clip,checked).focus_events?.length,2);
 assert.equal(upgradeClipEditDraft(clip,current).focus_events?.length??0,0);
 assert.throws(()=>validateClipEditDraft({...current,focus_events:[{id:'bad',source_ms:99999,mode:'reaction'}]},clip), {name:'ClipEditDraftError'});
});

test('legacy KLYP upgrade retains its green caption appearance', async () => {
 const {upgradeClipEditDraft}=await import("./clip-edit-draft.ts");

 const upgraded = upgradeClipEditDraft(clip, {...defaultClipEditDraft(clip),caption_style:'KLYP'});
 assert.equal(upgraded.caption_color,'green');
});

const cutaway = { id: "photo-1", asset_id: "asset-1", source_start_ms: 105000, source_end_ms: 108000, asset_in_ms: 0, fit: "cover", focal_point: { x: 0.5, y: 0.5 } };
function v3(overrides: Record<string, unknown> = {}) {
 return { ...v2(), version: 3, cutaways: [cutaway], ...overrides };
}
test("V2 upgrades to V3 preserving segments, caption overrides, and appearance", async () => {
 const { upgradeClipEditDraft } = await import("./clip-edit-draft.ts");
 const upgraded = upgradeClipEditDraft(clip, validateClipEditDraft(v2(), clip));
 assert.equal(upgraded.version, 3);
 assert.deepEqual(upgraded.cutaways, []);
 assert.deepEqual(upgraded.segments, v2().segments);
 assert.deepEqual(upgraded.caption_cues, v2().caption_cues);
 assert.equal(upgraded.caption_position, "bottom");
});
test("V3 photo cutaway survives validation, saved-draft read and unsaved export", () => {
 const checked = validateClipEditDraft(v3(), clip);
 assert.equal(checked.version, 3);
 if (checked.version !== 3) return;
 assert.deepEqual(checked.cutaways, [cutaway]);
 assert.equal(readClipEditDraft({ ...clip, edit_draft: checked }).unsupportedVersion, false);
 assert.deepEqual(toClipExportPayload(clip, checked).edit_draft, checked);
 assert.equal(toClipExportPayload(clip, checked).style, "BOLD");
});
test("V3 rejects over-limit, duplicate, overlapping, malformed and out-of-source cutaways", () => {
 const badCutaways = [
  null, {}, Array.from({ length: 13 }, (_, i) => ({ ...cutaway, id: String(i), source_start_ms: 100000 + i * 1000, source_end_ms: 100500 + i * 1000 })),
  [cutaway, { ...cutaway, source_start_ms: 108000, source_end_ms: 109000 }],
  [cutaway, { ...cutaway, id: "second", source_start_ms: 107000 }],
  ...[{ id: "" }, { id: "x".repeat(121) }, { asset_id: " " }, { asset_id: "x".repeat(121) },
    { source_start_ms: 99000 }, { source_end_ms: 131000 }, { source_end_ms: 105000 },
    { source_start_ms: NaN }, { source_end_ms: Infinity }, { asset_in_ms: -1 }, { asset_in_ms: NaN },
    { fit: "stretch" }, { focal_point: null }, { focal_point: { x: 1.1, y: 0 } }, { focal_point: { x: 0, y: NaN } },
  ].map(change => [{ ...cutaway, ...change }]),
 ];
 for (const cutaways of badCutaways) assert.throws(() => validateClipEditDraft(v3({ cutaways }), clip));
 const longClip = { ...clip, end_seconds: 300 };
 assert.throws(() => validateClipEditDraft(v3({ end_seconds: 300, segments: [{ id: "a", start_seconds: 100, end_seconds: 300 }] }), longClip));
});
test("V3 permits adjacent unordered cutaways and deleted anchors without mutating IDs", () => {
 const second = { ...cutaway, id: "photo-2", source_start_ms: 108000, source_end_ms: 111000 };
 const checked = validateClipEditDraft(v3({ cutaways: [second, cutaway, { ...cutaway, id: "removed", source_start_ms: 112000, source_end_ms: 115000 }] }), clip);
 assert.equal(checked.version, 3);
 if (checked.version === 3) assert.deepEqual(checked.cutaways.map(c => c.id), ["photo-2", "photo-1", "removed"]);
});
