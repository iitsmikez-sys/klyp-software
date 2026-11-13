import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");

test("every route that writes a file into the cache folder makes sure the folder exists first", () => {
  for (const [file, marker] of [
    ["app/api/clip/route.ts", "`clip-${Date.now()}-"],
    ["lib/legacy-clip-export-route.ts", "`clip-${Date.now()}-"],
    ["app/api/preview/route.ts", "`preview-${Date.now()}-"],
    ["app/api/thumbnail/route.ts", "${thumbCacheKey(url, start, end)}.jpg`"],
  ]) {
    const src = read(file);
    const at = src.indexOf(marker);
    assert.ok(at > 0, `${file} defines its output file`);
    const after = src.slice(at, at + 700);
    assert.ok(after.includes("await mkdir(CACHE_DIR, { recursive: true });"), `${file} creates the folder before ffmpeg writes to it`);
    assert.match(src, /import \{[^}]*\bmkdir\b[^}]*\} from "fs\/promises";/, `${file} imports mkdir`);
  }
});
