import assert from "node:assert/strict";
import test from "node:test";
import { shouldRetryYouTubeOverIpv6 } from "../lib/youtube-ipv6-fallback.ts";

const blocked = "ERROR: [youtube] yOkSedn_cfc: Sign in to confirm you’re not a bot";

test("retries a blocked YouTube download over IPv6", () => {
  assert.equal(shouldRetryYouTubeOverIpv6(["-f", "bestaudio/best", "https://youtu.be/yOkSedn_cfc"], blocked), true);
});

test("does not switch network for unrelated failures or hosts", () => {
  assert.equal(shouldRetryYouTubeOverIpv6(["https://youtu.be/yOkSedn_cfc"], "HTTP Error 404"), false);
  assert.equal(shouldRetryYouTubeOverIpv6(["https://www.twitch.tv/videos/123"], blocked), false);
  assert.equal(shouldRetryYouTubeOverIpv6(["--force-ipv6", "https://youtu.be/yOkSedn_cfc"], blocked), false);
});
