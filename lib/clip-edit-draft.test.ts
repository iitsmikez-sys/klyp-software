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
  assert.throws(() => validateClipEditDraft(draft({ vertical_layout: { version: 1, gameplay: { x: 0.9, y: 0, w: 1, h: 1 } } }), clip));
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
