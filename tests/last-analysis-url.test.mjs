import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sourceKeyToUrl, vodSourceKey } from "../lib/vod-source.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");

test("a saved video identity turns back into a link the clip routes accept", () => {
  const cases = [
    ["twitch:2926082452", "https://www.twitch.tv/videos/2926082452"],
    ["kick:01a184df-0210-7042-879d-c811b7e04bbf", "https://kick.com/video/01a184df-0210-7042-879d-c811b7e04bbf"],
    ["youtube:qOen1OcaOAg", "https://www.youtube.com/watch?v=qOen1OcaOAg"],
    ["upload:e436cf81-c6b3-4dd2-9fcc-bb52b4f29a29", "upload:e436cf81-c6b3-4dd2-9fcc-bb52b4f29a29"],
  ];
  for (const [key, url] of cases) {
    assert.equal(sourceKeyToUrl(key), url, key);
    if (!key.startsWith("upload:")) assert.equal(vodSourceKey(url), key, `${key} round-trips`);
  }
});

test("anything that is not a real identity gives no link, never a made-up one", () => {
  for (const key of ["", null, undefined, "twitch:abc", "kick:nope", "youtube:short", "other:123", "upload:../x"]) assert.equal(sourceKeyToUrl(key), "", String(key));
});

test("the last-analysis route rebuilds the link from the key, because the job stores no link", () => {
  const route = read("app/api/analyze/last/route.ts");
  assert.ok(route.includes('import { sourceKeyToUrl } from "@/lib/vod-source";'));
  assert.ok(route.includes('|| sourceKeyToUrl(row.source_key);'));
});
