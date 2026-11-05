import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");

test("the AI score pill sits in the top right of the picture, shows only for top picks, and never blocks a click", () => {
  const badge = read("components/ScoreBadge.tsx");
  assert.match(badge, /isTopPick\(\{ viral_score: score \}\)\) return null;/);
  assert.match(badge, /typeof score !== "number" \|\| !Number\.isFinite\(score\)/);
  assert.match(badge, /pointer-events-none absolute right-2 top-2/);
  assert.match(badge, /<span aria-hidden="true">★<\/span>/);
  assert.match(badge, /Math\.round\(score\)/);
  assert.match(badge, /border-accent\/60[^"]*text-accent/);
});

test("both clip cards show it over the thumbnail", () => {
  const compact = read("components/CompactClipCard.tsx");
  assert.match(compact, /<div className="relative">\s*<ClipThumbnail clip=\{clip\} onPlay=\{onPreview\} \/>\s*<ScoreBadge score=\{clip\.viral_score\} \/>\s*<\/div>/);
  const found = read("components/FoundClipCard.tsx");
  assert.match(found, /<ClipThumbnail clip=\{clip\} onPlay=\{onPreview\} \/>[\s\S]*<ScoreBadge score=\{clip\.viral_score\} \/>/);
  // The "Top pick" label stays on the left, so the two do not overlap.
  assert.match(found, /absolute left-2 top-2[^>]*>Top pick/);
});

test("the top-pick bar the badge uses is the same 65 as the rest of the app", async () => {
  const { isTopPick, QUALITY_BAR } = await import("../lib/clip-extras.ts");
  assert.equal(QUALITY_BAR, 65);
  assert.equal(isTopPick({ viral_score: 71 }), true);
  assert.equal(isTopPick({ viral_score: 65 }), true);
  assert.equal(isTopPick({ viral_score: 64 }), false);
});
