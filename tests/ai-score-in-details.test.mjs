import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isTopPick } from "../lib/clip-extras.ts";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

test("the clip Details show a simple star-and-number AI score, for top picks only", async () => {
  const modal = await read("components/ClipPreviewModal.tsx");
  const at = modal.indexOf("Top picks only");
  assert.ok(at > 0, "score block is present");
  const block = modal.slice(at, at + 900);
  assert.match(block, /isTopPick\(clip\)/);
  assert.match(block, /Math\.round\(clip\.viral_score\)/);
  assert.match(block, /AI score/);
  // it sits inside the Details panel, above "Why this moment"
  assert.ok(modal.indexOf("Why this moment", at) > at);
  assert.ok(modal.lastIndexOf("detailsOpen && (", at) > 0);
});

test("no score badge anywhere else: not on the clip cards, not in the clip header", async () => {
  const card = await read("components/FoundClipCard.tsx");
  const compact = await read("components/CompactClipCard.tsx");
  const modal = await read("components/ClipPreviewModal.tsx");
  for (const src of [card, compact]) assert.doesNotMatch(src, /viral_score|ScoreBadge/);
  assert.equal((modal.match(/viral_score/g) ?? []).length, 2); // the guard and the number, only in Details
  assert.doesNotMatch(modal, /ScoreBadge|ScoreBreakdown/);
});

test("a clip below the 65 bar (a near-miss extra) shows no score", () => {
  assert.equal(isTopPick({ viral_score: 87 }), true);
  assert.equal(isTopPick({ viral_score: 65 }), true);
  assert.equal(isTopPick({ viral_score: 64.9 }), false);
  assert.equal(isTopPick({ viral_score: 58 }), false);
});
