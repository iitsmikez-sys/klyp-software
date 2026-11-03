import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

test("the AI score is shown on every clip card, in the clip header, and its breakdown in the details", async () => {
  const card = await read("components/CompactClipCard.tsx");
  assert.match(card, /<ScoreBadge score=\{clip\.viral_score\}/);
  const modal = await read("components/ClipPreviewModal.tsx");
  assert.match(modal, /<ScoreBadge score=\{clip\.viral_score\}/);
  assert.match(modal, /<ScoreBreakdown clip=\{clip\}/);
});

test("the badge is shaded by score and explains what the score means", async () => {
  const badge = await read("components/ScoreBadge.tsx");
  assert.match(badge, /s >= 85/);
  assert.match(badge, /s >= 75/);
  assert.match(badge, /65 or more/);
  assert.match(badge, /90\+/);
});
