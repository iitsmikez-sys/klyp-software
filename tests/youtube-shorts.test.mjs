import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shortsStatus, withShortsTag, SHORTS_MAX_SECONDS } from "../lib/youtube-shorts.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");

test("a vertical or square clip up to 3 minutes is a Short; anything else is a regular video", () => {
  assert.deepEqual(shortsStatus({ aspect_ratio: "9:16", start_seconds: 10, end_seconds: 59 }), { isShort: true, reason: "ok" });
  assert.equal(shortsStatus({ aspect_ratio: "1:1", start_seconds: 0, end_seconds: 60 }).isShort, true);
  assert.equal(shortsStatus({ aspect_ratio: "9:16", start_seconds: 0, end_seconds: SHORTS_MAX_SECONDS }).isShort, true);
  assert.deepEqual(shortsStatus({ aspect_ratio: "9:16", start_seconds: 0, end_seconds: SHORTS_MAX_SECONDS + 1 }), { isShort: false, reason: "too_long" });
  assert.deepEqual(shortsStatus({ aspect_ratio: "16:9", start_seconds: 0, end_seconds: 30 }), { isShort: false, reason: "not_vertical" });
  assert.deepEqual(shortsStatus({ aspect_ratio: "Original" }), { isShort: false, reason: "not_vertical" });
  assert.deepEqual(shortsStatus(null), { isShort: false, reason: "not_vertical" });
  assert.equal(shortsStatus({ aspect_ratio: "9:16" }).isShort, true, "no times means no length check");
});

test("#Shorts is added once, on its own line", () => {
  assert.equal(withShortsTag(""), "#Shorts");
  assert.equal(withShortsTag("My clip"), "My clip\n\n#Shorts");
  assert.equal(withShortsTag("My clip #shorts"), "My clip #shorts");
  assert.equal(withShortsTag(withShortsTag("x")), "x\n\n#Shorts");
});

test("the dialog warns about regular videos and the server tags Shorts", () => {
  const dialog = read("components/YouTubePublishDialog.tsx");
  assert.ok(dialog.includes("This will upload as a YouTube Short") && dialog.includes("This clip is not vertical"));
  assert.ok(dialog.includes("withShortsTag(description)"));
  const route = read("app/api/youtube/publish/route.ts");
  assert.ok(route.includes("shortsStatus(clipPayload).isShort") && route.includes("withShortsTag(details.description)"));
});
