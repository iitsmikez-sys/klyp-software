import assert from "node:assert/strict";
import test from "node:test";
import { vodSourceKey } from "../lib/vod-source.ts";

test("Twitch URL variants share one VOD identity", () => {
  assert.equal(vodSourceKey("https://www.twitch.tv/videos/2901248464"), "twitch:2901248464");
  assert.equal(vodSourceKey("https://m.twitch.tv/videos/2901248464?filter=archives"), "twitch:2901248464");
});

test("YouTube URL variants share one VOD identity", () => {
  assert.equal(vodSourceKey("https://youtu.be/abcdefghijk?si=share"), "youtube:abcdefghijk");
  assert.equal(vodSourceKey("https://www.youtube.com/watch?si=share&v=abcdefghijk"), "youtube:abcdefghijk");
});

test("rejects invalid VOD references", () => {
  assert.equal(vodSourceKey("https://twitch.tv/videos/not-a-vod"), null);
  assert.equal(vodSourceKey("https://evil.example/videos/2901248464"), null);
  assert.equal(vodSourceKey("https://twitch.tv/videos/2901248464/extra"), null);
});
