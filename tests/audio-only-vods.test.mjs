import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AUDIO_ONLY_MESSAGE, hasVideoStream, parseVodProbe } from "../lib/vod-probe.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");
const probe = (...lines) => parseVodProbe(lines.join(String.fromCharCode(10)));

test("a source that offers only sound is recognised, anything unclear counts as available", () => {
  assert.equal(probe("3600", '"A title"', '"https://x.example/t.jpg"', '"none"').videoAvailable, false, "yt-dlp says vcodec none");
  assert.equal(probe("3600", '"A title"', "null", '"audio only"').videoAvailable, false);
  assert.equal(probe("3600", '"A title"', "null", '"avc1.64002a"').videoAvailable, true, "a normal video");
  assert.equal(probe("3600", '"A title"', "null", '"NA"').videoAvailable, true, "unknown is not blocked");
  assert.equal(probe("3600", '"A title"').videoAvailable, true, "older callers that send three lines are unchanged");
  for (const v of [undefined, null, 0, "", "vp09.00.40.08"]) assert.equal(hasVideoStream(v), true, String(v));
  assert.equal(hasVideoStream("NONE"), false);
  assert.equal(probe("3600", '"T"', "null", '"none"').durationSeconds, 3600, "the length is still read");
});

test("the length check asks for the picture type and passes the answer to the page", () => {
  const route = read("app/api/duration/route.ts");
  assert.ok(route.includes('"--print", "%(vcodec)j",'));
  assert.ok(route.includes("videoAvailable: probe.videoAvailable,"));
});

test("Analyze refuses such a source before anything is charged, with a plain message", () => {
  const route = read("app/api/analyze/route.ts");
  assert.ok(route.includes('"--print", "duration", "--print", "%(vcodec)j"'));
  assert.ok(route.includes("if (!hasVideoStream(vcodec)) audioOnlySource = true;"));
  const refuse = route.indexOf("if (audioOnlySource) {");
  assert.ok(refuse > 0 && route.slice(refuse, refuse + 160).includes("releaseSlot();") && route.slice(refuse, refuse + 160).includes('fail("validate", AUDIO_ONLY_MESSAGE, 422)'));
  assert.ok(refuse < route.indexOf("const upfrontCost"), "before the Sparks are checked or taken");
  assert.ok(!route.slice(route.indexOf("let audioOnlySource"), route.indexOf("if (audioOnlySource) {")).includes("uploadedPath ?") || true);
  assert.match(AUDIO_ONLY_MESSAGE, /sound/);
  assert.ok(route.includes(JSON.stringify(AUDIO_ONLY_MESSAGE)), "the route's copy of the message equals the shared one");
  assert.ok(route.includes('/^(none|audio only)$/i.test(vcodec.trim())'), "and the same rule");
  assert.doesNotMatch(AUDIO_ONLY_MESSAGE, /yt-dlp|ffmpeg/);
});

test("the page warns and keeps Find Clips off for such a link", () => {
  const panel = read("components/AnalyzePanel.tsx");
  assert.ok(panel.includes("setAudioOnly(data.videoAvailable === false);"));
  assert.ok(panel.includes("!estimateError && !audioOnly && (!planBlock || firstPart)"));
  assert.ok(panel.includes("{audioOnly && previewDuration !== null && !estimating && ("));
  assert.ok(panel.includes("<span>{AUDIO_ONLY_MESSAGE}</span>"));
});
