import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");
const landing = read("components/landing/LandingPage.tsx");

test("the landing page speaks to clippers and streamers, with the pain of scrubbing long VODs", () => {
  assert.ok(landing.includes("AI-powered clipping for Twitch and Kick"));
  assert.ok(landing.includes("Stop watching 6-hour VODs"));
  assert.ok(landing.includes("to find 30 seconds."));
  assert.ok(landing.includes("Paste the link. Klyp finds the funny, wild, quotable moments, and gives you vertical clips with captions and a hook."));
  assert.ok(landing.includes("100+ clippers and streamers</span> clipping with Klyp"));
});

test("the landing page makes no promise of views or going viral", () => {
  assert.doesNotMatch(landing, /go viral|guaranteed|viral clips/i);
});
