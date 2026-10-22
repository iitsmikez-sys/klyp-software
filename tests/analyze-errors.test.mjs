import assert from "node:assert/strict";
import test from "node:test";
import { userFacingAnalysisError } from "../lib/analyze-errors.ts";

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
