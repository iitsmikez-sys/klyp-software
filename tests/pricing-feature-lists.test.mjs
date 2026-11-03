import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");
const upgrade = read("app/(dashboard)/dashboard/upgrade/page.tsx");
const landing = read("components/PricingSection.tsx");

test("the Sparks lines no longer say how many VODs", () => {
  for (const src of [upgrade, landing]) {
    assert.ok(!src.includes("vodsPhrase"));
    assert.ok(!/about \d+ VODs?/i.test(src));
  }
});

test("both cards say AI clipping with Virality Score", () => {
  assert.equal(upgrade.split("AI clipping with Virality Score").length - 1, 2, "Free and Pro on the upgrade page");
  assert.ok(landing.includes("AI clipping with Virality Score"));
});

test("Free lists the four free caption styles and Pro lists more styles with the diamond and a full editor", () => {
  assert.ok(upgrade.includes("AI captions: Bold, Klyp, Spark and Pulse"));
  assert.ok(!upgrade.includes("BOLD, CLEAN"));
  assert.ok(upgrade.includes('{ text: "More caption styles", pro: true }'));
  assert.ok(upgrade.includes("<ProDiamond"));
  assert.ok(upgrade.includes('{ text: "Full editor" }'));
  assert.ok(!upgrade.includes("add photos and video, move text"));
  assert.ok(landing.includes('text: "Full editor"') && landing.includes('text: "More caption styles"'));
});
