import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");

test("Settings no longer has a default caption style picker", () => {
  const settings = read("app/(dashboard)/dashboard/settings/page.tsx");
  assert.doesNotMatch(settings, /Default caption style/);
  assert.doesNotMatch(settings, /klyp-default-style/);
  assert.ok(settings.includes("Streamer handle"), "the rest of Clip Defaults is still there");
});

test("new results always start on Bold, so an old saved choice cannot silently apply with no way to change it", () => {
  const panel = read("components/AnalyzePanel.tsx");
  assert.ok(panel.includes('const defaultStyle: CaptionStyle = "BOLD";'));
  assert.doesNotMatch(panel, /klyp-default-style/);
});
