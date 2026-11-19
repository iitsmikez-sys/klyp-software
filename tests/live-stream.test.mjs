import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isStillLive, liveModeFor, LIVE_GRACE_SECONDS } from "../lib/live-vod.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");
const NOW = Date.parse("2026-11-19T12:00:00Z");

test("a VOD whose end is right at now is live, and one that ended long ago is not", () => {
  // Began 10 hours ago and is 10 hours long so far: still going.
  assert.equal(isStillLive("2026-11-19T02:00:00Z", 10 * 3600, NOW), true);
  // Ended 20 hours ago.
  assert.equal(isStillLive("2026-11-18T01:00:00Z", 3 * 3600, NOW), false);
  // Just ended inside the grace window still counts, a bit later does not.
  assert.equal(isStillLive("2026-11-19T10:00:00Z", 2 * 3600 - 60, NOW), true);
  assert.equal(isStillLive("2026-11-19T10:00:00Z", 2 * 3600 - LIVE_GRACE_SECONDS - 60, NOW), false);
});

test("bad numbers are never called live", () => {
  assert.equal(isStillLive("not a date", 3600, NOW), false);
  assert.equal(isStillLive("2026-11-19T10:00:00Z", 0, NOW), false);
  assert.equal(isStillLive("2026-11-19T10:00:00Z", Number.NaN, NOW), false);
});

test("free users are sold auto-clipping", () => {
  assert.equal(liveModeFor({ isPro: false, channels: [], streamUserId: "1" }), "upsell");
  assert.equal(liveModeFor({ isPro: false, channels: [{ twitch_user_id: "1", auto_clip_enabled: true }], streamUserId: "1" }), "upsell");
});

test("Pro with auto-clipping on for the live channel is told it will happen by itself", () => {
  assert.equal(liveModeFor({ isPro: true, channels: [{ twitch_user_id: "7", auto_clip_enabled: true }], streamUserId: "7" }), "auto");
});

test("Pro with no Twitch channel connected is asked to connect", () => {
  assert.equal(liveModeFor({ isPro: true, channels: [], streamUserId: "7" }), "connect");
  assert.equal(liveModeFor({ isPro: true, channels: [{ twitch_user_id: null, auto_clip_enabled: true }], streamUserId: "7" }), "connect");
});

test("Pro looking at someone else's stream, or with auto-clipping off, is told to come back", () => {
  assert.equal(liveModeFor({ isPro: true, channels: [{ twitch_user_id: "9", auto_clip_enabled: true }], streamUserId: "7" }), "wait");
  assert.equal(liveModeFor({ isPro: true, channels: [{ twitch_user_id: "7", auto_clip_enabled: false }], streamUserId: "7" }), "wait");
  assert.equal(liveModeFor({ isPro: true, channels: [{ twitch_user_id: "9", auto_clip_enabled: true }], streamUserId: undefined }), "wait");
});

test("the duration route reports live, and a failed check never breaks the preview", () => {
  const route = read("app/api/duration/route.ts");
  assert.ok(route.includes("live: await liveModeOf(url, profile.id, planOf(profile) === \"pro\")"));
  assert.ok(/async function liveModeOf[\s\S]*?try \{[\s\S]*?\} catch \(err\) \{[\s\S]*?return null;/.test(route), "the live check swallows its own errors");
});

test("the panel blocks Analyze for a live stream and shows the notice instead of the preview", () => {
  const panel = read("components/AnalyzePanel.tsx");
  assert.ok(panel.includes("!audioOnly && !liveMode &&"), "canSubmit is off while live");
  assert.ok(panel.includes("<LiveStreamNotice mode={liveMode} />"));
  assert.ok(panel.includes("!estimating && !liveMode && <div"), "the 'ready to analyze' preview is hidden while live");
  const notice = read("components/LiveStreamNotice.tsx");
  assert.ok(notice.includes("/dashboard/upgrade?need=live"));
  assert.ok(notice.includes("/dashboard/streams"));
  assert.ok(notice.includes("Nothing was charged"));
});

test("the upgrade page opens on the live reason", () => {
  const page = read("app/(dashboard)/dashboard/upgrade/page.tsx");
  assert.ok(page.includes('"Get clips the moment your stream ends"'));
});
