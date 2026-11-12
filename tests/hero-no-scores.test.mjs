import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");

test("the landing page's example clips show their type but no score", () => {
  const band = read("components/hero/BeforeAfterBand.tsx");
  assert.doesNotMatch(band, /score:\s*\d/);
  assert.match(read("components/hero/ClipStack.tsx"), /score\?: number;/);
});
