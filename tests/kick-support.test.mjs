import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
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

function filesWithLinkCheck(dir) {
  const found = [];
  for (const entry of readdirSync(new URL(`../${dir}`, import.meta.url), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) found.push(...filesWithLinkCheck(rel));
    else if (/\.(ts|tsx)$/.test(entry.name) && /VOD_URL_PATTERN =/.test(read(rel))) found.push(rel);
  }
  return found;
}

test("every copy of the VOD link check in the app accepts Kick links, including the paste box and thumbnails", () => {
  const files = [...filesWithLinkCheck("app"), ...filesWithLinkCheck("lib"), ...filesWithLinkCheck("components")];
  for (const must of ["components/AnalyzePanel.tsx", "app/api/thumbnail/route.ts", "lib/legacy-clip-export-route.ts"]) {
    assert.ok(files.includes(must), `${must} is checked`);
  }
  assert.ok(files.length >= 7, "found every copy of the link check");
  for (const p of files) {
    const m = /VOD_URL_PATTERN =\s*(\/.+\/i);/.exec(read(p));
    assert.ok(m, `${p} has the pattern`);
    const re = eval(m[1]);
    assert.ok(re.test(`https://kick.com/chaifailed/videos/${ID}`), `${p} accepts channel-style Kick links`);
    assert.ok(re.test(`https://kick.com/video/${ID}`), `${p} accepts kick.com/video links`);
    assert.ok(!re.test("https://kick.com/chaifailed"), `${p} rejects a bare channel`);
    assert.ok(re.test("https://www.twitch.tv/videos/123"), `${p} still accepts Twitch`);
  }
});

test("a cached video probe stops being reused once its signed Kick thumbnail link would have expired", () => {
  const route = read("app/api/duration/route.ts");
  assert.match(route, /SIGNED_THUMBNAIL_TTL_MS = 4 \* 60_000/);
  assert.ok(route.includes('cached.probe.thumbnail?.includes("X-Amz-Signature")'));
  assert.ok(route.includes("Date.now() - cached.at > SIGNED_THUMBNAIL_TTL_MS"));
  assert.ok(route.includes("durationCache.set(url, { probe, at: Date.now() })"));
});
