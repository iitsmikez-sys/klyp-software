import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { clipPreset, clipCrf } from "../lib/clip-encode.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");

test("clips are built with the faster settings unless the service is told otherwise", () => {
  assert.equal(clipPreset({}), "veryfast");
  assert.equal(clipCrf({}), "21");
});

test("the settings can be changed with CLIP_PRESET and CLIP_CRF", () => {
  assert.equal(clipPreset({ CLIP_PRESET: "fast" }), "fast");
  assert.equal(clipCrf({ CLIP_CRF: "18" }), "18");
});

test("a bad value falls back to the safe default instead of breaking every export", () => {
  assert.equal(clipPreset({ CLIP_PRESET: "bogus; rm" }), "veryfast");
  assert.equal(clipPreset({ CLIP_PRESET: "" }), "veryfast");
  for (const bad of ["abc", "5", "99", "20.5", ""]) assert.equal(clipCrf({ CLIP_CRF: bad }), "21", `CRF ${bad}`);
});

test("the export route uses those settings, not fixed ones", () => {
  const route = read("app/api/clip/route.ts");
  assert.ok(route.includes('"-preset", clipPreset(),') && route.includes('"-crf", clipCrf(),'));
  assert.ok(!route.includes('"-preset", "fast"'));
});
