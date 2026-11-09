import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BLOCK_MEMORY_MS, forgetBlockedVideo, recentlyBlockedMessage, rememberBlockedVideo, youtubeVideoId } from "../lib/youtube-block-memory.ts";

const watch = ["-f", "bestaudio", "https://www.youtube.com/watch?v=plN7JMbadRg"];

test("finds the video id in watch, short, shorts and live links", () => {
  assert.equal(youtubeVideoId(watch), "plN7JMbadRg");
  assert.equal(youtubeVideoId(["https://youtu.be/B6biwxo0dMQ?t=5"]), "B6biwxo0dMQ");
  assert.equal(youtubeVideoId(["https://www.youtube.com/shorts/8lcLvf78zig"]), "8lcLvf78zig");
  assert.equal(youtubeVideoId(["https://www.youtube.com/watch?feature=share&v=nkNFOUPq73M"]), "nkNFOUPq73M");
  assert.equal(youtubeVideoId(["https://www.twitch.tv/videos/123456789"]), null);
});

test("a refused video is remembered for three minutes, then tried again", () => {
  const t = 1_000_000;
  assert.equal(recentlyBlockedMessage(watch, t), null);
  rememberBlockedVideo(watch, "Sign in to confirm you're not a bot", t);
  assert.equal(recentlyBlockedMessage(watch, t + 1000), "Sign in to confirm you're not a bot");
  assert.equal(recentlyBlockedMessage(["https://youtu.be/AAAAAAAAAAA"], t + 1000), null, "other videos are untouched");
  assert.equal(recentlyBlockedMessage(watch, t + BLOCK_MEMORY_MS + 1), null, "forgotten after the memory runs out");
});

test("a video that downloads fine is forgotten at once, and non-YouTube links are never remembered", () => {
  rememberBlockedVideo(watch, "blocked");
  forgetBlockedVideo(watch);
  assert.equal(recentlyBlockedMessage(watch), null);
  rememberBlockedVideo(["https://www.twitch.tv/videos/1"], "x");
  assert.equal(recentlyBlockedMessage(["https://www.twitch.tv/videos/1"]), null);
});

test("the downloader checks the memory first and records a refusal", () => {
  const bin = readFileSync(new URL("../lib/bin.ts", import.meta.url), "utf8");
  assert.ok(bin.includes("recentlyBlockedMessage(args)"));
  assert.ok(bin.includes("rememberBlockedVideo(args, message)"));
});
