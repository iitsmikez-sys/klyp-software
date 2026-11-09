import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const panel = readFileSync(new URL("../components/AnalyzePanel.tsx", import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");

test("a free user who pastes a video over the Free limit gets a pop-up with an upgrade button", () => {
  assert.ok(panel.includes("const showCapPopup = !!planBlock && !isPro && !firstPart && previewDuration !== null && !estimating && capDismissedFor !== url;"));
  assert.ok(panel.includes('aria-labelledby="cap-title"'));
  assert.ok(panel.includes("This video is {fmtTime(previewDuration ?? 0)} long"));
  assert.ok(panel.includes("Free covers videos up to {PLAN_LIMITS.free.youtube / 3600} hours."));
  assert.ok(panel.includes("Every great moment, not just the best two hours. More clips from the whole stream, with no watermark."));
  assert.ok(panel.includes('href="/dashboard/upgrade"'));
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
