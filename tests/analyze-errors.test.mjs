import assert from "node:assert/strict";
import test from "node:test";
import * as analyzeErrors from "../lib/analyze-errors.ts";

const { userFacingAnalysisError } = analyzeErrors;

const botError = "yt-dlp exited with code 1: ERROR: [youtube] yOkSedn_cfc: Sign in to confirm you're not a bot";

test("explains a YouTube bot block without exposing yt-dlp output", () => {
  const message = userFacingAnalysisError("download", "https://youtu.be/yOkSedn_cfc", botError);
  assert.match(message, /YouTube blocked/);
  assert.match(message, /Twitch VOD or upload/);
  assert.match(message, /No Sparks were charged/);
  assert.doesNotMatch(message, /yt-dlp/);
});

test("recognizes the curly apostrophe in the live YouTube error", () => {
  const liveError = "ERROR: [youtube] yOkSedn_cfc: Sign in to confirm you’re not a bot.";
  assert.match(userFacingAnalysisError("download", "https://youtu.be/yOkSedn_cfc", liveError), /YouTube blocked/);
});

test("preserves unrelated download and analysis errors", () => {
  assert.equal(userFacingAnalysisError("download", "https://www.twitch.tv/videos/123", botError), botError);
  assert.equal(userFacingAnalysisError("analyze", "https://youtu.be/yOkSedn_cfc", botError), botError);
});

test("recognizes the user-facing YouTube block so the page can offer file upload", () => {
  const message = `${userFacingAnalysisError("download", "https://youtu.be/yOkSedn_cfc", botError)} (failed at: download)`;
  assert.equal(analyzeErrors.isYouTubeBotBlockError?.(message) ?? false, true);
  assert.equal(analyzeErrors.isYouTubeBotBlockError?.("Could not transcribe audio") ?? false, false);
});
test("explains exhausted Anthropic credits without exposing provider JSON", () => {
  const liveError = '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."},"request_id":"req_example"}';
  const message = userFacingAnalysisError("analyze", "https://www.twitch.tv/videos/123", liveError);
  assert.match(message, /temporarily unavailable/i);
  assert.match(message, /No Sparks were charged/i);
  assert.doesNotMatch(message, /request_id|Plans & Billing|400/);
});

test("a failed clip download says what to do without yt-dlp output", () => {
  const live = "yt-dlp exited with code 1: utube] No title found in player responses\nERROR: [youtube] plN7JMbadRg: Sign in to confirm you’re not a bot. Use --cookies-from-browser";
  const blocked = analyzeErrors.userFacingClipError(live);
  assert.match(blocked, /YouTube is blocking this video/);
  assert.doesNotMatch(blocked, /yt-dlp|cookies/);
  const other = analyzeErrors.userFacingClipError("yt-dlp exited with code 1: ERROR: Video unavailable");
  assert.match(other, /couldn't be downloaded right now/);
  assert.doesNotMatch(other, /yt-dlp/);
  assert.equal(analyzeErrors.userFacingClipError("Clips are capped at 3 minutes."), "Clips are capped at 3 minutes.");
});

test("a failed length check on a YouTube link says YouTube is limiting downloads, other links keep the generic message", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../components/AnalyzePanel.tsx", import.meta.url), "utf8");
  assert.ok(src.includes("YouTube is limiting downloads right now, so Klyp can’t read this video. Try again later, or use a Twitch or Kick link."));
  assert.ok(src.includes("Couldn’t confirm the VOD length or Sparks cost. Check the link and try again."));
});

const liveError = "yt-dlp timed out after 600s. stderr: d=1.04x size= 15360KiB time=00:10:20.01 bitrate= 202.9kbits/s speed=1.04x size= 15360KiB time=00:10:20.01 bitrate= 202.9kbits/s speed=1.04x";
const slowError = "yt-dlp timed out after 600s. stderr: size= 1024KiB time=00:00:30.00 bitrate= 280kbits/s speed=0.05x";

test("a download that crawls at the speed the video plays says the stream is probably still live", () => {
  const message = userFacingAnalysisError("download", "https://www.twitch.tv/videos/2932151237", liveError);
  assert.equal(message, analyzeErrors.LIVE_VOD_MESSAGE);
  assert.match(message, /still live/);
  assert.match(message, /No Sparks were charged/);
  assert.doesNotMatch(message, /yt-dlp|stderr|KiB/);
});

test("any other download timeout gets a plain message too, not raw yt-dlp output", () => {
  const message = userFacingAnalysisError("download", "https://www.twitch.tv/videos/1", slowError);
  assert.equal(message, analyzeErrors.DOWNLOAD_TIMEOUT_MESSAGE);
  assert.doesNotMatch(message, /yt-dlp|stderr/);
  // a fast download that still timed out (huge file) is not blamed on a live stream
  assert.equal(userFacingAnalysisError("download", "https://www.twitch.tv/videos/1", "yt-dlp timed out after 600s. stderr: speed=14.2x"), analyzeErrors.DOWNLOAD_TIMEOUT_MESSAGE);
});

test("the same wording is used when a clip download times out, and other stages are left alone", () => {
  assert.equal(analyzeErrors.userFacingClipError(liveError), analyzeErrors.LIVE_VOD_MESSAGE);
  assert.equal(userFacingAnalysisError("transcribe", "https://www.twitch.tv/videos/1", liveError), liveError);
  assert.equal(analyzeErrors.timedOutDownloadMessage("something else entirely"), null);
});
