import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { vodSourceKey } from "../lib/vod-source.ts";
import { sourceKindOf, checkSourceLimit, describeLimits } from "../lib/plan-limits.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");
const ID = "70f175d4-d962-4c12-8224-88d4ee09a460";

test("Kick VOD links turn into a stable kick: key, in both URL shapes, ignoring tracking params", () => {
  assert.equal(vodSourceKey(`https://kick.com/chaifailed/videos/${ID}`), `kick:${ID}`);
  assert.equal(vodSourceKey(`https://www.kick.com/video/${ID.toUpperCase()}?t=5`), `kick:${ID}`);
});

test("Kick links that are not a finished VOD are refused", () => {
  assert.equal(vodSourceKey("https://kick.com/chaifailed"), null);
  assert.equal(vodSourceKey("https://kick.com/chaifailed/videos/not-a-uuid"), null);
  assert.equal(vodSourceKey(`https://notkick.com/x/videos/${ID}`), null);
});

test("Kick uses the same length limits as Twitch for each plan", () => {
  assert.equal(sourceKindOf(`kick:${ID}`), "kick");
  assert.deepEqual(checkSourceLimit("free", "kick", 3600), { ok: true });
  assert.equal(checkSourceLimit("free", "kick", 3 * 3600).ok, false);
  assert.match(checkSourceLimit("free", "kick", 3 * 3600).message, /Kick VODs up to 2 hours/);
  assert.equal(checkSourceLimit("pro", "kick", 7 * 3600).ok, true);
  assert.equal(describeLimits("free").kickMaxSeconds, describeLimits("free").twitchMaxSeconds);
});

test("the platform label says Kick", () => {
  const ui = read("lib/clip-ui.ts");
  assert.ok(ui.includes('host === "kick.com"') && ui.includes('return "Kick"'));
});

test("all four routes that take a VOD link accept Kick links", () => {
  for (const p of ["app/api/analyze/route.ts", "app/api/duration/route.ts", "app/api/preview/route.ts", "app/api/clip/route.ts"]) {
    const m = /VOD_URL_PATTERN =\s*(\/.+\/i);/.exec(read(p));
    assert.ok(m, `${p} has the pattern`);
    const re = eval(m[1]);
    assert.ok(re.test(`https://kick.com/chaifailed/videos/${ID}`), `${p} accepts channel-style Kick links`);
    assert.ok(re.test(`https://kick.com/video/${ID}`), `${p} accepts kick.com/video links`);
    assert.ok(!re.test("https://kick.com/chaifailed"), `${p} rejects a bare channel`);
    assert.ok(re.test("https://www.twitch.tv/videos/123"), `${p} still accepts Twitch`);
  }
});
