import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");
const filterFrom = (src) => {
  const m = src.match(/function handleFilter\(handle: string\): string \{([\s\S]*?)\n\}\n/);
  assert.ok(m, "handleFilter not found");
  return new Function("handle", m[1])("karmicmr");
};

test("the handle is plain text under the video: no box, centered, soft shadow", () => {
  for (const file of ["app/api/clip/route.ts", "lib/legacy-clip-export-route.ts"]) {
    const f = filterFrom(read(file));
    assert.doesNotMatch(f, /box=1/, file);
    assert.match(f, /x=\(main_w-text_w\)\/2/, file);
    assert.match(f, /shadowcolor=/, file);
  }
});

test("only Pro exports carry the handle; Free keeps the Klyp watermark", () => {
  assert.match(read("app/api/clip/route.ts"), /isPro && handle \? \[handleFilter\(handle\)\]/);
  assert.match(read("lib/legacy-clip-export-route.ts"), /if \(isPro && handle\)/);
});

test("a real render puts the handle in the bottom band and nothing in the top corner", () => {
  const dir = mkdtempSync(join(tmpdir(), "klyp-handle-"));
  try {
    const out = join(dir, "o.png");
    const f = filterFrom(read("app/api/clip/route.ts"));
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=0x202020:size=1080x1920:duration=1",
      "-vf", f, "-frames:v", "1", out]);
    const raw = execFileSync("ffmpeg", ["-loglevel", "error", "-i", out, "-f", "rawvideo", "-pix_fmt", "gray", "-"], { maxBuffer: 1080 * 1920 * 2 });
    const bright = (y0, y1, x0, x1) => { let n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (raw[y * 1080 + x] > 120) n++; return n; };
    assert.ok(bright(1660, 1800, 300, 780) > 200, "handle text not found in the bottom band");
    assert.equal(bright(0, 300, 540, 1080), 0, "nothing should be in the top-right corner");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("Settings: Pro gets a show/hide switch, Free is told it is a Pro feature, and hiding stops it being sent", () => {
  const settings = read("app/(dashboard)/dashboard/settings/page.tsx");
  assert.match(settings, /Show my handle on clips/);
  assert.match(settings, /Your handle on clips is a Pro feature/);
  assert.match(read("lib/streamer-handle.ts"), /!isHandleVisible\(\)\) return undefined/);
});
