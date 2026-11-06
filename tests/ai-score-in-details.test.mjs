import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isTopPick } from "../lib/clip-extras.ts";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

test("the clip Details show a simple star-and-number AI score, for every clip", async () => {
  const modal = await read("components/ClipPreviewModal.tsx");
  const at = modal.indexOf("Every clip shows its score");
  assert.ok(at > 0, "score block is present");
  const block = modal.slice(at, at + 900);
  assert.doesNotMatch(block, /isTopPick\(clip\) &&/);
  assert.match(block, /Below the 65 top-pick bar\./);
  assert.match(block, /bg-amber-300/);
  assert.match(block, /Math\.round\(clip\.viral_score\)/);
  assert.match(block, /AI score/);
  // it sits inside the Details panel, above "Why this moment"
  assert.ok(modal.indexOf("Why this moment", at) > at);
  assert.ok(modal.lastIndexOf("detailsOpen && (", at) > 0);
});

test("the score shows in Details and as a small pill on the clip cards, but not in the preview's header", async () => {
  const card = await read("components/FoundClipCard.tsx");
  const compact = await read("components/CompactClipCard.tsx");
  const modal = await read("components/ClipPreviewModal.tsx");
  // The cards show it only through the shared pill (top picks only), never as a raw number of their own.
  for (const src of [card, compact]) {
    assert.ok(src.includes("<ScoreBadge score={clip.viral_score} />"));
    assert.equal((src.match(/viral_score/g) ?? []).length, 1);
  }
  assert.equal((modal.match(/viral_score/g) ?? []).length, 2); // the guard and the number, only in Details
  assert.doesNotMatch(modal, /ScoreBadge|ScoreBreakdown/);
});

test("the 65 bar still decides what counts as a top pick, even though every clip shows its score", () => {
  assert.equal(isTopPick({ viral_score: 87 }), true);
  assert.equal(isTopPick({ viral_score: 65 }), true);
  assert.equal(isTopPick({ viral_score: 64.9 }), false);
  assert.equal(isTopPick({ viral_score: 58 }), false);
});
