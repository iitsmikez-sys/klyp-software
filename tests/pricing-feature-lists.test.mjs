import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FREE_FEATURES, PRO_FEATURES, FREE_STYLE_NAMES } from "../lib/plan-features.ts";
import { FREE_CAPTION_STYLES } from "../lib/clips.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");
const upgrade = read("app/(dashboard)/dashboard/upgrade/page.tsx");
const landing = read("components/PricingSection.tsx");
const freeText = FREE_FEATURES.map((f) => f.text);
const proText = PRO_FEATURES.map((f) => f.text);

test("the landing page and the upgrade page read the same lists, so they can never disagree", () => {
  for (const src of [upgrade, landing]) {
    assert.ok(src.includes('from "@/lib/plan-features"'));
    assert.ok(src.includes("FREE_FEATURES") && src.includes("PRO_FEATURES"));
  }
  // No second copy of any line is typed into either page.
  for (const line of [...freeText, ...proText]) {
    assert.ok(!upgrade.includes(`"${line}"`) && !landing.includes(`"${line}"`), `typed again: ${line}`);
  }
});

test("the Sparks lines no longer say how many VODs, and both plans say AI clipping with Virality Score", () => {
  for (const src of [upgrade, landing]) {
    assert.ok(!src.includes("vodsPhrase"));
    assert.ok(!/about \d+ VODs?/i.test(src));
  }
  assert.ok(freeText.includes("AI clipping with Virality Score") && proText.includes("AI clipping with Virality Score"));
  assert.ok(freeText.includes("60 Sparks every 30 days") && proText.includes("500 Sparks every 30 days"));
});

test("Free names every free caption style (Highlighter included); Pro counts the rest honestly and keeps the diamond and full editor", () => {
  for (const style of FREE_CAPTION_STYLES) assert.ok(FREE_STYLE_NAMES[style], `${style} has a display name`);
  assert.ok(freeText.includes("AI captions: Bold, Klyp, Spark, Pulse and Highlighter"));
  assert.ok(proText.includes("13 more caption styles"));
  assert.equal(PRO_FEATURES.find((f) => f.text === "13 more caption styles")?.pro, true, "gets the Pro diamond");
  assert.ok(proText.includes("Full editor"));
  assert.ok(upgrade.includes("<ProDiamond"));
  assert.ok(!upgrade.includes("BOLD, CLEAN"));
});

test("Kick is named, and nothing says unlimited or promises what the product cannot keep", () => {
  assert.ok(freeText.includes("YouTube, Twitch and Kick videos up to 2 hours"));
  assert.ok(proText.some((t) => /Twitch, Kick and YouTube \(up to 8 hours\), plus direct video uploads/.test(t)));
  for (const t of [...freeText, ...proText]) assert.doesNotMatch(t, /unlimited|∞/i, t);
  assert.doesNotMatch(landing + upgrade, /Unlimited exports/);
});

test("the upgrade page's social line is a true number and has no made-up faces", () => {
  assert.ok(!upgrade.includes("300+ streamers"));
  assert.ok(!upgrade.includes("AvatarStack"));
  assert.ok(upgrade.includes("150+ creators</span> have signed up for Klyp"));
});

test("the Pro card lists YouTube post scheduling as coming soon, on both pages", () => {
  assert.deepEqual(PRO_FEATURES.find((f) => f.text === "Post scheduling to YouTube"), { text: "Post scheduling to YouTube", soon: true });
  assert.ok(upgrade.includes("Coming soon") && upgrade.includes("<Soon />"));
  assert.ok(landing.includes("(coming soon)"));
});
