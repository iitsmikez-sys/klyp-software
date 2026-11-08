import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CAPTION_STYLES, FREE_CAPTION_STYLES, isProCaptionStyle, resolveCaptionStyle } from "../lib/clips.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");
const PRO = ["CLEAN", "SLIDE", "BOUNCE", "GLOW", "COMIC", "KEYWORD", "HYPE", "POP", "FIRE", "TRICOLOR", "FOCUS", "DUO", "MARKER"];

test("five caption styles are free, every other one is Pro", () => {
  assert.deepEqual([...FREE_CAPTION_STYLES].sort(), ["BOLD", "HIGHLIGHTER", "KLYP", "PULSE", "SPARK"]);
  for (const s of FREE_CAPTION_STYLES) assert.equal(isProCaptionStyle(s), false, s);
  for (const s of PRO) assert.equal(isProCaptionStyle(s), true, s);
  assert.equal(PRO.length + FREE_CAPTION_STYLES.length, CAPTION_STYLES.length, "every style is classified");
});

test("a Free account gets Bold for a Pro style; Pro and free styles are untouched", () => {
  for (const s of PRO) {
    assert.equal(resolveCaptionStyle(s, false), "BOLD", s);
    assert.equal(resolveCaptionStyle(s, true), s, s);
  }
  for (const s of FREE_CAPTION_STYLES) assert.equal(resolveCaptionStyle(s, false), s, s);
});

test("both export routes apply the rule on the server, before any rendering", () => {
  for (const file of ["app/api/clip/route.ts", "lib/legacy-clip-export-route.ts"]) {
    const src = read(file);
    assert.ok(src.includes("if (style) style = resolveCaptionStyle(style, isPro);"), file);
    assert.ok(src.indexOf("resolveCaptionStyle(style, isPro)") < src.indexOf("if (raw) {"), file);
  }
});

test("every caption picker shows the diamond and the Pro note", () => {
  for (const file of ["components/CaptionTemplatePicker.tsx", "components/ClipPreview.tsx", "components/SavedClipEditor.tsx", "components/LegacySavedClipEditor.tsx", "app/(dashboard)/dashboard/settings/page.tsx"]) {
    const src = read(file);
    assert.ok(src.includes("<StyleDiamond"), file + " diamond");
    assert.ok(src.includes("<ProStyleNote"), file + " note");
  }
  const badge = read("components/ProDiamond.tsx");
  assert.ok(badge.includes('tier === "pro" || !isProCaptionStyle(style)'), "hidden for Pro members and free styles");
  assert.ok(!badge.includes("rounded-lg bg-"), "the gem has no square behind it");
});
