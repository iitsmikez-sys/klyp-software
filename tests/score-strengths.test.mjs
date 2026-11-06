import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");

test("the Details of both clip windows show the strongest three scores, inside the Details panel", () => {
  for (const file of ["components/ClipPreviewModal.tsx", "components/ResultsClipPreviewModal.tsx"]) {
    const src = read(file);
    assert.match(src, /import ScoreBreakdown from "\.\/ScoreBreakdown";/, file);
    assert.match(src, /<ScoreBreakdown clip=\{clip\} top=\{3\} \/>/, file);
    assert.ok(src.indexOf("<ScoreBreakdown") > src.indexOf("detailsOpen &&") || src.indexOf("<ScoreBreakdown") > src.indexOf("detailsOpen && ("), `${file}: inside Details`);
  }
});

test("only the strongest dimensions are shown, so a calm clip is not drawn as a row of empty bars", () => {
  const src = read("components/ScoreBreakdown.tsx");
  assert.match(src, /top\?: number/);
  assert.match(src, /const MIN_STRENGTH = 5;/);
  assert.match(src, /\.sort\(\(a, b\) => b\.value - a\.value\)\.filter\(\(d\) => d\.value >= MIN_STRENGTH\)\.slice\(0, top\)/);
  assert.match(src, /if \(dims\.length === 0\) return null;/);
});

test("a clip with no saved breakdown (older clips) shows nothing, never zeros", () => {
  const ui = read("lib/clip-ui.ts");
  assert.match(ui, /if \(dims\.some\(\(d\) => typeof d\.value !== "number"\)\) return null;/);
  const src = read("components/ScoreBreakdown.tsx");
  assert.match(src, /if \(!all\) return null;/);
  // the ranking rule, run on a calm story: Comedy, Story and Emotion lead; Hype 3 and Skill 0 are left out
  const dims = [{ label: "Hype", value: 3 }, { label: "Emotion", value: 9 }, { label: "Skill", value: 0 }, { label: "Comedy", value: 16 }, { label: "Story", value: 14 }];
  assert.deepEqual([...dims].sort((a, b) => b.value - a.value).filter((d) => d.value >= 5).slice(0, 3).map((d) => d.label), ["Comedy", "Story", "Emotion"]);
});

test("a freshly analyzed clip carries its five scores into the window before it is saved", () => {
  const panel = read("components/AnalyzePanel.tsx");
  assert.match(panel, /dim_hype: clip\.dimensions\?\.hype \?\? null, dim_emotion: clip\.dimensions\?\.emotion \?\? null/);
});
