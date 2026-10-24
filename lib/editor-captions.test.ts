import test from "node:test";
import assert from "node:assert/strict";
import { resolveEditorCues, captionAppearance, editorOverlayAtTime } from "./editor-captions.ts";
import { generateTimedCueAss } from "./captions.ts";
import { defaultClipEditDraft, upgradeClipEditDraft, toClipExportPayload } from "./clip-edit-draft.ts";
import type { SavedClip } from "./clip-ui.ts";
const clip = { id: "c", url: "u", title: "t", start_seconds: 100, end_seconds: 110, words: [{ text: "original", start: 101000, end: 101500 }] } as SavedClip;
const base = () => upgradeClipEditDraft(clip, defaultClipEditDraft(clip));
test("explicit corrected and split cues survive while deleted cues stay absent", () => {
 const draft = { ...base(), caption_cues: [{ id: "a", start_ms: 101000, end_ms: 102000, text: "corrected" }, { id: "b", start_ms: 102000, end_ms: 103000, text: "corrected" }] };
 assert.deepEqual(resolveEditorCues(draft, clip), [{ id: "a", start_ms: 1000, end_ms: 2000, text: "corrected" }, { id: "b", start_ms: 2000, end_ms: 3000, text: "corrected" }]);
 assert.deepEqual(resolveEditorCues({ ...draft, caption_cues: [] }, clip), []);
 assert.equal(clip.words?.[0].text, "original");
});
test("crossing cues fragment across cuts with stable unique IDs and removed cues disappear", () => {
 const draft = { ...base(), segments: [{ id: "first", start_seconds: 100, end_seconds: 102 }, { id: "last", start_seconds: 105, end_seconds: 110 }], caption_cues: [{ id: "cross", start_ms: 101000, end_ms: 106000, text: "crossing" }, { id: "gone", start_ms: 103000, end_ms: 104000, text: "gone" }] };
 const cues = resolveEditorCues(draft, clip);
 assert.deepEqual(cues.map(c => [c.start_ms, c.end_ms, c.text]), [[1000,2000,"crossing"],[2000,3000,"crossing"]]);
 assert.equal(new Set(cues.map(c => c.id)).size, 2);
 assert.deepEqual(resolveEditorCues(draft, clip), cues);
});
test("derived cues retain corrected text while export retains source data for server validation", () => {
 const draft = base(); draft.words![0].text = "fixed";
 assert.equal(resolveEditorCues(draft, clip)[0].text, "fixed");
 assert.equal(toClipExportPayload(clip, draft).caption_cues, null);
 assert.deepEqual(resolveEditorCues(draft, clip), [{ id: "auto-0", start_ms: 950, end_ms: 2450, text: "fixed" }]);
});
test("hook follows first three output seconds and captions use output time", () => {
 const draft = { ...base(), hook: "HOOK", segments: [{ id: "last", start_seconds: 105, end_seconds: 110 }] };
 assert.equal(editorOverlayAtTime(draft, clip, 0).hook, "HOOK");
 assert.equal(editorOverlayAtTime(draft, clip, 2.999).hook, "HOOK");
 assert.equal(editorOverlayAtTime(draft, clip, 3).hook, null);
 assert.equal(editorOverlayAtTime(draft, clip, -1).hook, null);
});
test("timed ASS preserves cue times and shares canvas colors and safe-area anchors", () => {
 for (const position of ["top", "center", "bottom"] as const) {
  const appearance = captionAppearance({ ...base(), caption_color: "pink", caption_position: position });
  assert.equal(appearance.color, "#FF69B4");
  assert.equal(appearance.anchorY, position === "top" ? 80/1920 : position === "center" ? 0.5 : 1-80/1920);
  const ass = generateTimedCueAss([{ id: "a", start_ms: 1250, end_ms: 2750, text: "{corrected}\\text" }], "CLEAN", appearance);
  assert.match(ass, /0:00:01.25,0:00:02.75/);
  assert.match(ass, /&H00B469FF/);
  assert.ok(ass.includes(`\\an5\\pos(540,${1920*appearance.anchorY + (appearance.alignment === 8 ? 29 : appearance.alignment === 2 ? -29 : 0)})`));
  assert.ok(ass.includes("correctedtext"));
 }
});

test("fragment IDs never collide with an explicit cue ID", () => {
 const draft = { ...base(), segments: [{ id: "one", start_seconds: 100, end_seconds: 102 }, { id: "two", start_seconds: 105, end_seconds: 110 }], caption_cues: [{ id: "cross", start_ms: 101000, end_ms: 106000, text: "cross" }, { id: "cross:fragment:0", start_ms: 106000, end_ms: 107000, text: "other" }] };
 assert.equal(new Set(resolveEditorCues(draft, clip).map(c => c.id)).size, 3);
});
test("short output clamps the hook and derived captions disappear in deleted footage", () => {
 const draft = { ...base(), hook: "hook", segments: [{ id: "s", start_seconds: 105, end_seconds: 106 }] };
 assert.equal(editorOverlayAtTime(draft, clip, 1).hook, null);
 assert.deepEqual(resolveEditorCues(draft, clip), []);
});
test("all palette colors reach ASS and composed safe geometry scales", () => {
 for (const [caption_color, expected] of [["white","&H00FFFFFF"],["yellow","&H0000FFFF"],["green","&H00A0E500"],["pink","&H00B469FF"]] as const) {
  const appearance = captionAppearance({ ...base(), caption_color, caption_position: "center" });
  const ass = generateTimedCueAss([{ start_ms: 0, end_ms: 1000, text: "hi" }], "BOLD", appearance, { w: 540, h: 960 }, { x: 0, y: 0, w: 540, h: 672 });
  assert.ok(ass.includes(expected));
  assert.ok(ass.includes("\\an5\\pos(270,336)"));
 }
});
test("newer overlapping caption replaces the earlier caption in preview and ASS", () => {
 const draft = { ...base(), caption_cues: [{ id: "a", start_ms: 101000, end_ms: 104000, text: "first" }, { id: "b", start_ms: 102000, end_ms: 103000, text: "second" }] };
 assert.deepEqual(resolveEditorCues(draft, clip).map(c => [c.start_ms,c.end_ms]), [[1000,2000],[2000,3000]]);
 assert.equal(editorOverlayAtTime(draft, clip, 2.5).caption?.text, "second");
 assert.equal(editorOverlayAtTime(draft, clip, 3.5).caption, null);
 const ass = generateTimedCueAss(resolveEditorCues(draft, clip), "BOLD", captionAppearance(draft));
 assert.match(ass, /0:00:01.00,0:00:02.00/);
 assert.doesNotMatch(ass, /0:00:01.00,0:00:04.00/);
});
test("preview and ASS share special character display normalization without altering saved text", () => {
 const text = "{hello}\\Nworld\nnext";
 const draft = { ...base(), caption_cues: [{ id: "a", start_ms: 101000, end_ms: 102000, text }] };
 assert.equal(editorOverlayAtTime(draft, clip, 1.5).caption?.text, "helloNworld next");
 assert.equal(draft.caption_cues[0].text, text);
 const ass = generateTimedCueAss(resolveEditorCues(draft, clip), "CLEAN", captionAppearance(draft));
 assert.ok(ass.includes("helloNworld next"));
});
import * as captions from "./captions.ts";
test("raw timed ASS input enforces the same overlap policy", () => {
 const ass = generateTimedCueAss([{ start_ms: 1000, end_ms: 4000, text: "first" },{ start_ms: 2000, end_ms: 3000, text: "second" }], "BOLD", captionAppearance(base()));
 assert.match(ass, /0:00:01.00,0:00:02.00/);
 assert.doesNotMatch(ass, /0:00:01.00,0:00:04.00/);
});
test("CLEAN multiline positions use its own font size and explicit per-line ASS positions", () => {
 const appearance = captionAppearance({ ...base(), caption_position: "center" });
 const text = "MMMMMMMMMMMMMMMMMMMM MMMMMMMMMMMMMMMMMMMM";
 const layout = captions.layoutTimedCaption(text, "CLEAN", appearance, { w: 540, h: 960 });
 assert.equal(layout.fontSize, 29);
 assert.equal(layout.lineHeight, 35);
 assert.deepEqual(layout.lines.map(line => line.y), [462.5,497.5]);
 const ass = generateTimedCueAss([{ start_ms: 0,end_ms:1000,text }], "CLEAN", appearance, { w:540,h:960 });
 assert.equal(ass.split("\n").filter(line => line.startsWith("Dialogue:")).length, 2);
 assert.ok(ass.includes("\\an5\\pos(270,462.5)"));
 assert.ok(ass.includes("\\an5\\pos(270,497.5)"));
});
test("animated templates retain motion in full timeline exports", () => {
 const appearance = captionAppearance({ ...base(), caption_position: "center" });
 const cue = [{ start_ms: 0, end_ms: 1000, text: "Moment" }];
 assert.match(generateTimedCueAss(cue, "PULSE", appearance), /\\fscx72.*\\t\(0,180/);
 assert.match(generateTimedCueAss(cue, "SLIDE", appearance), /\\move\(540,1015,540,960,0,220\)/);
 assert.match(generateTimedCueAss(cue, "SPARK", appearance), /\\fscx82.*\\t\(0,140/);
});
