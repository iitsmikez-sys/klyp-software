import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hookDurationMs, generateHookAss, HOOK_DURATION_MS, HOOK_MIN_MS, HOOK_MAX_MS } from "../lib/captions.ts";
import { validateClipEditDraft, defaultClipEditDraft, upgradeClipEditDraft, ClipEditDraftError } from "../lib/clip-edit-draft.ts";
import { editorOverlayAtTime } from "../lib/editor-captions.ts";
import { drawHookPreview } from "../lib/hook-preview.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");
const clip = { id: "c1", url: "https://example.com/v", title: "Title", hooks: ["HOOK ONE", "two", "three"], start_seconds: 100, end_seconds: 130, words: null };
const base = () => ({ ...upgradeClipEditDraft(clip, defaultClipEditDraft(clip)), hook: "BIG PLAY" });
const endTimes = (ass) => [...ass.matchAll(/^Dialogue: \d+,0:00:00\.00,([0-9:.]+),Hook/gm)].map((m) => m[1]);

test("the hook stays 3 seconds unless the editor stretched it, and a stretch stays between half a second and the clip", () => {
  assert.equal(HOOK_DURATION_MS, 3000);
  assert.equal(hookDurationMs(undefined), 3000);
  assert.equal(hookDurationMs(null), 3000);
  assert.equal(hookDurationMs(NaN), 3000);
  assert.equal(hookDurationMs(7000), 7000);
  assert.equal(hookDurationMs(100), HOOK_MIN_MS);
  assert.equal(hookDurationMs(9_999_999), HOOK_MAX_MS);
  assert.equal(HOOK_MAX_MS, 180_000);
});

test("the exported hook is burned for the chosen length", () => {
  assert.deepEqual(endTimes(generateHookAss("BIG PLAY")), ["0:00:03.00"]);
  assert.deepEqual(endTimes(generateHookAss("BIG PLAY", undefined, "IMPACT", undefined, 7500)), ["0:00:07.50"]);
  assert.deepEqual(endTimes(generateHookAss("BIG PLAY", undefined, "IMPACT", undefined, 65_000)), ["0:01:05.00"]);
  // The white card and its text share the same length.
  assert.deepEqual(endTimes(generateHookAss("BIG PLAY", undefined, "WHITE_BOX", undefined, 12_000)), ["0:00:12.00", "0:00:12.00"]);
});

test("a saved hook length is checked: whole milliseconds, half a second up to three minutes", () => {
  const ok = validateClipEditDraft({ ...defaultClipEditDraft(clip), hook_duration_ms: 8000 }, clip);
  assert.equal(ok.hook_duration_ms, 8000);
  assert.equal(validateClipEditDraft(defaultClipEditDraft(clip), clip).hook_duration_ms, undefined);
  for (const bad of [400, 499, 180_001, 1234.5, "3000", null, -5]) {
    assert.throws(() => validateClipEditDraft({ ...defaultClipEditDraft(clip), hook_duration_ms: bad }, clip), ClipEditDraftError, String(bad));
  }
});

test("the hook length survives the editor's draft versions", () => {
  const v3 = validateClipEditDraft({ ...base(), hook_duration_ms: 20_000 }, clip);
  assert.equal(v3.version, 3);
  assert.equal(v3.hook_duration_ms, 20_000);
  assert.equal(upgradeClipEditDraft(clip, { ...defaultClipEditDraft(clip), hook_duration_ms: 6000 }).hook_duration_ms, 6000);
});

test("the editor preview shows the hook for the chosen length", () => {
  const draft = base();
  assert.equal(editorOverlayAtTime(draft, clip, 2).hook, "BIG PLAY");
  assert.equal(editorOverlayAtTime(draft, clip, 5).hook, null);
  const stretched = { ...draft, hook_duration_ms: 8000 };
  assert.equal(editorOverlayAtTime(stretched, clip, 5).hook, "BIG PLAY");
  assert.equal(editorOverlayAtTime(stretched, clip, 7.9).hook, "BIG PLAY");
  assert.equal(editorOverlayAtTime(stretched, clip, 8.1).hook, null);
  // Never past the end of the clip.
  assert.equal(editorOverlayAtTime({ ...draft, hook_duration_ms: 180_000 }, clip, 31).hook, null);
});

test("the canvas hook is drawn only while it should be on screen", () => {
  const draws = (t, durationMs) => {
    let texts = 0;
    const ctx = new Proxy({}, { get: (target, key) => {
      if (key === "measureText") return () => ({ width: 100 });
      if (key === "fillText") return () => { texts++; };
      if (key in target) return target[key];
      return () => {};
    }, set: (target, key, value) => { target[key] = value; return true; } });
    drawHookPreview(ctx, t, "BIG PLAY", "IMPACT", 1080, 1920, undefined, durationMs);
    return texts > 0;
  };
  assert.equal(draws(2, undefined), true);
  assert.equal(draws(5, undefined), false);
  assert.equal(draws(5, 8000), true);
  assert.equal(draws(9, 8000), false);
});

test("the timeline has a drag handle on the hook and the editor and export both use the saved length", () => {
  const timeline = read("components/EditorTimeline.tsx");
  assert.match(timeline, /startHookResize/);
  assert.match(timeline, /Change how long the hook stays on screen/);
  assert.match(timeline, /hookKey/);
  const editor = read("components/ClipTimelineEditor.tsx");
  assert.match(editor, /onResizeHook=\{resizeHookMs\}/);
  assert.match(editor, /hook_duration_ms: clampHookMs\(ms\)/);
  assert.match(read("components/VerticalLayoutPreview.tsx"), /editor\.draft\.hook_duration_ms/);
  assert.match(read("app/api/clip/route.ts"), /editorDraft\?\.hook_duration_ms/);
});
