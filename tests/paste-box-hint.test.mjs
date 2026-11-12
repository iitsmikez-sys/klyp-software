import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");
const hint = read("components/PasteBoxHint.tsx");
const panel = read("components/AnalyzePanel.tsx");
const css = read("components/PasteBoxHint.module.css");

test("the hint reads 'Paste a link from' and rolls YouTube, Twitch, Kick every 4 seconds, each in its own colour", () => {
  assert.match(hint, /Paste a link from/);
  assert.match(hint, /PASTE_HINT_HOLD_MS = 4000/);
  assert.match(hint, /name: "YouTube", className: "text-\[#ff4e45\]"/);
  assert.match(hint, /name: "Twitch", className: "text-\[#a970ff\]"/);
  assert.match(hint, /name: "Kick", className: "text-\[#53fc18\]"/);
  assert.match(hint, /setInterval\(/);
  assert.match(hint, /clearInterval\(id\)/, "the timer is cleaned up when the hint goes away");
});

test("no caption or explanation text is shown with it", () => {
  assert.doesNotMatch(hint + panel, /holds for \d seconds|Loops on its own/i);
});

test("the hint ignores clicks and is hidden from screen readers", () => {
  assert.match(hint, /aria-hidden="true"/);
  assert.match(hint, /pointer-events-none/);
});

test("it only shows while the box is empty, not focused, not loading, and motion is allowed", () => {
  assert.match(panel, /const animateHint = !urlFocused && url === "" && !loading && !reduceMotion;/);
  assert.match(panel, /onFocus=\{\(\) => setUrlFocused\(true\)\}/);
  assert.match(panel, /onBlur=\{\(\) => setUrlFocused\(false\)\}/);
  assert.match(panel, /\{animateHint && <PasteBoxHint \/>\}/);
});

test("people who turn on reduce motion, or whose browser cannot say, get the plain placeholder", () => {
  assert.match(panel, /useState\(true\)/);
  assert.match(panel, /prefers-reduced-motion: reduce/);
  assert.match(panel, /placeholder=\{animateHint \? "" : PASTE_PLACEHOLDER\}/);
  assert.ok(panel.includes('const PASTE_PLACEHOLDER = YOUTUBE_ENABLED ? "Paste a YouTube, Twitch, or Kick VOD link" : "Paste a Twitch or Kick VOD link";'));
  assert.match(css, /prefers-reduced-motion: reduce/);
});

test("screen readers get the plain wording through the box's own description", () => {
  assert.match(panel, /aria-describedby="vod-url-hint"/);
  assert.match(panel, /<span id="vod-url-hint" className="sr-only">\{PASTE_PLACEHOLDER\}<\/span>/);
  assert.match(panel, /aria-label="VOD URL"/);
});

test("the paste box keeps its size: the hint is laid over the box, not added to it", () => {
  assert.match(panel, /<div className="relative min-w-0 flex-1">\s*<input/);
  assert.match(hint, /absolute inset-y-0 left-4 right-4/);
});
