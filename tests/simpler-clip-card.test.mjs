import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");
const card = read("components/FoundClipCard.tsx");
const panel = read("components/AnalyzePanel.tsx");

test("the card has one clear Download button, with the wait and the save time in plain words", () => {
  assert.match(card, /'Download'\}<\/button>/);
  assert.match(card, /Usually 1 to 3 minutes · Saved for \$\{keptDays\} days/);
  assert.match(card, /Usually 1 to 3 minutes\. Keep this page open\./, "while it works, it says how long and not to leave");
  assert.match(card, /Preparing \$\{rawSeconds\}s…/);
});

test("Edit, Download Raw, Keep and Discard are tucked under More, not shown as loose buttons", () => {
  const at = card.indexOf("<details");
  assert.ok(at > 0 && card.includes("<summary"));
  const inside = card.slice(at);
  for (const label of ["'Edit'", "'Download Raw'", "'Keep'", "Discard"]) assert.ok(inside.includes(label), label);
  const outside = card.slice(0, at);
  assert.doesNotMatch(outside, /onClick=\{onRawExport\}|onClick=\{onKeep\}|onClick=\{onDiscard\}|onClick=\{onCustomize\}/);
  assert.match(inside, />More<\/summary>/);
});

test("Preview, the score badge, the Top pick tag and the saved message are still on the card", () => {
  assert.match(card, /onClick=\{onPreview\}[^>]*>Preview<\/button>/);
  assert.match(card, /<ScoreBadge score=\{clip\.viral_score\} \/>/);
  assert.match(card, /Top pick/);
  assert.match(card, /kept && <span role="status"/);
  assert.match(card, /isMediaExpired\(clip\) \? 'expired' : clip\.archive_status/);
});

test("the card is told how many days the plan keeps results: 5 on Free, 30 on Pro", () => {
  assert.match(card, /keptDays: number/);
  assert.match(panel, /keptDays=\{resultsKeptDays\(isPro\)\}/);
  assert.match(panel, /import \{ resultsKeptDays \} from "@\/lib\/results-retention";/);
});

test("the preview window the card opens uses the same plain 'Download' label", () => {
  assert.match(read("components/ResultsClipPreviewModal.tsx"), /: "Download"\}/);
});
