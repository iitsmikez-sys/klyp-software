import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateAss } from "../lib/captions.ts";
import { CAPTION_FONT_FAMILIES } from "../lib/caption-fonts.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");
const words = [{ text: "scam", start: 0, end: 300 }, { text: "bro", start: 300, end: 600 }];

test("the bundled caption fonts and their licenses ship with the app", () => {
  for (const file of ["Poppins-ExtraBold.ttf", "Poppins-SemiBold.ttf", "Anton-Regular.ttf", "ArchivoBlack-Regular.ttf", "../font-licenses/OFL-Poppins.txt", "../font-licenses/OFL-Anton.txt", "../font-licenses/OFL-ArchivoBlack.txt"]) {
    assert.ok(existsSync(new URL(`../public/fonts/${file}`, import.meta.url)), file);
  }
  const css = read("app/globals.css");
  for (const family of CAPTION_FONT_FAMILIES) assert.ok(css.includes(`font-family: "${family}"`), family);
});

test("captions use the bundled font with no fake bold, and a thicker outline", () => {
  const ass = generateAss(words, 0, 1000, "BOLD", { w: 1080, h: 1920 });
  assert.match(ass, /Style: Default,Poppins ExtraBold,82,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,/);
  assert.match(ass, /,0,0,1,5,0,2,/); // outline 4 -> 5
  assert.match(generateAss(words, 0, 1000, "CLEAN", { w: 1080, h: 1920 }), /Style: Default,Poppins SemiBold,/);
});

test("the export hands libass the fonts folder in both export routes", () => {
  for (const file of ["app/api/clip/route.ts", "lib/legacy-clip-export-route.ts"]) {
    const src = read(file);
    assert.match(src, /fontsdir=/, file);
    assert.match(src, /\$\{fontsOpt\(\)\}/, file);
  }
});

test("libass really picks each bundled font from the fonts folder", () => {
  const dir = mkdtempSync(join(tmpdir(), "klyp-fonts-"));
  try {
    for (const family of ["Poppins ExtraBold", "Poppins SemiBold", "Anton", "Archivo Black"]) {
      const ass = generateAss(words, 0, 1000, "BOLD", { w: 1080, h: 1920 }).replace("Poppins ExtraBold", family);
      const file = ".tmp-crisp-fonts.ass"; // relative, so the filter needs no drive-letter escaping
      writeFileSync(file, ass);
      const r = spawnSync("ffmpeg", ["-loglevel", "verbose", "-y", "-f", "lavfi", "-i", "color=c=black:size=1080x1920:duration=1",
        "-vf", `subtitles='${file}':fontsdir='public/fonts'`, "-frames:v", "1", join(dir, "o.png")], { encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr.slice(-300));
      const picked = r.stderr.split("\n").filter((l) => l.includes("fontselect")).join("\n");
      assert.ok(picked.includes(`(${family},`) && picked.includes(`-> ${family.split(" ")[0]}`), `${family} was not found: ${picked}`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(".tmp-crisp-fonts.ass", { force: true }); }
});

test("previews draw at screen resolution and with the same fonts as the export", () => {
  for (const file of ["components/ClipPreview.tsx", "components/SavedClipEditor.tsx", "components/LegacySavedClipEditor.tsx"]) {
    assert.match(read(file), /window\.devicePixelRatio/, file);
  }
  const stage = read("components/VerticalLayoutPreview.tsx");
  assert.match(stage, /devicePixelRatio/);
  assert.match(stage, /ensureCaptionFonts\(\)/);
  const canvasText = read("lib/caption-preview.ts");
  assert.match(canvasText, /defaultCaptionFontFamily\(style\)/);
  assert.doesNotMatch(canvasText, /Arial/);
});
