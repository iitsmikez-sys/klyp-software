import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { detectContentType } from "../lib/detect-content-type.ts";
import { clipCountForDuration } from "../lib/sparks.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");

test("the caps are 15 for a video under 2 hours and 20 beyond, and the database accepts both", () => {
  assert.equal(clipCountForDuration(98 * 60), 15);
  assert.equal(clipCountForDuration(3 * 3600), 20);
  const jobs = read("lib/analysis-jobs.ts");
  assert.match(jobs, /DB_REQUESTED_CLIP_VALUES = \[1, 2, 3, 5, 7, 10, 12, 20\]/);
  for (const n of [15, 20]) assert.ok([1, 2, 3, 5, 7, 10, 12, 20].find((v) => v >= n) >= n, `${n} fits`);
});

test("two moments 30 seconds apart in one scene are both kept; overlapping ones are still merged", () => {
  const pipeline = read("lib/analyze-pipeline.ts");
  assert.ok(pipeline.includes("const DEDUPE_WINDOW_S = 30;"));
  assert.ok(pipeline.includes("(kept.start_seconds < clip.end_seconds && kept.end_seconds > clip.start_seconds)"), "overlap rule kept");
  assert.match(read("lib/clip-extras.ts"), /EXTRA_DEDUPE_WINDOW_S = 30/);
});

test("the quality bar is unchanged at 65, because it also decides billing and what counts as a top pick", () => {
  assert.match(read("lib/clip-extras.ts"), /export const QUALITY_BAR = 65;/);
});

test("the title decides Gaming or IRL, and a title that says nothing decides nothing", () => {
  assert.equal(detectContentType("I became the biggest crashout in gta rp.."), "gaming");
  assert.equal(detectContentType("NoPixel 5.0 stream"), "gaming");
  assert.equal(detectContentType("Valorant ranked grind"), "gaming");
  assert.equal(detectContentType("Just Chatting with chat"), "irl");
  assert.equal(detectContentType("IRL walking tour"), "irl");
  assert.equal(detectContentType("Playing games and just chatting"), null, "both signals: no guess");
  assert.equal(detectContentType("Friday stream"), null);
  assert.equal(detectContentType(""), null);
  assert.equal(detectContentType(undefined), null);
});

test("the panel offers Auto, uses the detected type, and a pinned choice always wins", () => {
  const panel = read("components/AnalyzePanel.tsx");
  assert.ok(panel.includes('useState<ContentType | "auto">("auto")'));
  assert.ok(panel.includes('contentChoice === "auto" ? detectedContent ?? DEFAULT_CONTENT_TYPE : contentChoice'));
  assert.ok(panel.includes('(["auto", ...CONTENT_TYPES] as const).map'));
  assert.ok(panel.includes("detectContentType(inputMode === \"file\" ? uploadedFile?.name : previewMeta?.title)"));
});

test("the roleplay section lists the patterns that make standalone GTA RP clips, and keeps same-scene moments separate", () => {
  const pipeline = read("lib/analyze-pipeline.ts");
  for (const piece of ["a diss built on an absurdly specific phrase", "a character trying to help and making it worse", "a fake flex", "a contradiction played completely straight", "a flirting mix-up", "a boast with an absurd number", "Return each distinct moment separately"]) {
    assert.ok(pipeline.includes(piece), piece);
  }
});
