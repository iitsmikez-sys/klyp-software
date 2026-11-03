import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("both clip views preview the finished look by default, with a switch back to the original footage", () => {
  for (const file of ["components/ResultsClipPreviewModal.tsx", "components/ClipPreviewModal.tsx"]) {
    const src = read(file);
    assert.match(src, /useState\(true\)/, file);
    assert.match(src, /<LookSwitch finished=\{finishedLook\}/, file);
    assert.match(src, /<FinishedOverlays hook=\{clip\.hooks\?\.\[0\]\}/, file);
    assert.match(src, /9 \/ 16/, file);
  }
  const look = read("components/FinishedLook.tsx");
  assert.match(look, /Finished look/);
  assert.match(look, /Original footage/);
  // Same cue builder as the real export, so caption timing matches.
  assert.match(look, /buildCaptionCues/);
});

test("thumbnails are not touched by the finished-look preview", () => {
  assert.doesNotMatch(read("components/ClipThumbnail.tsx"), /FinishedLook/);
  assert.doesNotMatch(read("lib/clip-thumbnails.ts"), /FinishedLook/);
});
