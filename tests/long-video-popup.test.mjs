import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const panel = readFileSync(new URL("../components/AnalyzePanel.tsx", import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");

test("a free user who pastes a video over the Free limit gets a pop-up with an upgrade button", () => {
  assert.ok(panel.includes("const showCapPopup = !!planBlock && !isPro && !firstPart && ownHourFor !== url && previewDuration !== null && !estimating && capDismissedFor !== url;"));
  assert.ok(panel.includes('aria-labelledby="cap-title"'));
  assert.ok(panel.includes("This video is {fmtTime(previewDuration ?? 0)} long"));
  assert.ok(panel.includes("Free covers videos up to {FREE_HOURS_TEXT}."));
  assert.ok(panel.includes("Klyp looks at all {lengthWords(previewDuration ?? 0)}, so more of your stream's great moments become clips. No watermark."));
  assert.ok(panel.includes("Get the whole video with Pro"));
  assert.ok(panel.includes("Limited: only {FREE_HOURS_TEXT} of this video's {lengthWords(previewDuration ?? 0)}, and downloads carry the Klyp watermark."));
  assert.ok(panel.includes("Uses {estimateSparks(FREE_PART_SECONDS)} of your free Sparks."));
  // The Pro call to action is the shared offer box: the $3 pass when offered, otherwise the plain link with the monthly price.
  assert.ok(panel.includes('<ProOfferCta source="long_video_popup" fallbackLabel={`Get Pro, $${MONTHLY_PRICE_USD} a month`} />'));
  assert.ok(!/up to d+ clips|up to 1[052] clips/i.test(panel.slice(panel.indexOf('aria-labelledby="cap-title"'), panel.indexOf('aria-labelledby="cap-title"') + 3000)), "the pop-up never promises a clip count");
  const cta = readFileSync(new URL("../components/ProOfferCta.tsx", import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");
  assert.ok(cta.includes('href="/dashboard/upgrade"'), "no offer means the plain Pro plans link");
  assert.ok(cta.includes("Cancel anytime."));
});

test("the too-long pop-up shows the $3 pass when offered, starts checkout in one click, and always states the $28", async () => {
  const cta = readFileSync(new URL("../components/ProOfferCta.tsx", import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");
  assert.ok(cta.includes('fetch("/api/stripe/checkout").then((r) => r.json())'));
  assert.ok(cta.includes('body: JSON.stringify({ interval: "month" })'));
  assert.ok(cta.includes("window.location.href = data.url;"));
  assert.ok(cta.includes("source,") || cta.includes("source }"), "the click records which pop-up it came from");
  const { rawOfferFrom, rawOfferCopy } = await import("../lib/raw-pro.ts");
  const copy = rawOfferCopy(rawOfferFrom({ trial: { days: 4, sparks: 250, price_cents: 300 }, first_month: null }));
  assert.equal(copy.button, "Start for $3");
  assert.ok(copy.detail.includes("$28 a month unless you cancel first"));
  assert.equal(rawOfferCopy(rawOfferFrom({ trial: null, first_month: null })), null);
});

test("'Not now' closes it for that link only, and Pro users never see it", () => {
  assert.ok(panel.includes("onClick={() => setCapDismissedFor(url)}"));
  assert.ok(panel.includes("!isPro"));
});

test("each time a free person hits the limit is counted once per link, as a plain event", () => {
  assert.ok(panel.includes('trackEvent("long_video_limit"'));
  assert.ok(panel.includes("capTrackedFor.current === url"));
  assert.match("long_video_limit", /^[a-z_]{1,40}$/, "fits the usage_events name rule");
});

test("the pop-up makes no price promise that the upgrade page might not honour", () => {
  const start = panel.indexOf('aria-labelledby="cap-title"');
  const block = panel.slice(start, start + 1800);
  assert.doesNotMatch(block, /\$\d/);
});
