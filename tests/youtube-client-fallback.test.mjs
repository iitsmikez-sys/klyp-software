import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isYouTubeBotChallenge, withYoutubeClient, tryYoutubeClients, YOUTUBE_FALLBACK_CLIENTS } from "../lib/youtube-client-fallback.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");
const YT = ["-f", "best", "https://www.youtube.com/watch?v=abcdefghijk"];
const BOT = "ERROR: [youtube] abcdefghijk: Sign in to confirm you’re not a bot. Use --cookies-from-browser";

test("only a YouTube link that was answered with the bot check counts", () => {
  assert.equal(isYouTubeBotChallenge(YT, BOT), true);
  assert.equal(isYouTubeBotChallenge(YT, "Sign in to confirm you're not a bot"), true, "straight apostrophe too");
  assert.equal(isYouTubeBotChallenge(YT, "HTTP Error 403: Forbidden"), false, "another error is not the bot check");
  assert.equal(isYouTubeBotChallenge(["-f", "best", "https://www.twitch.tv/videos/123"], BOT), false, "other sites never");
  assert.equal(isYouTubeBotChallenge(["https://kick.com/x/videos/01a184df-0210-7042-879d-c811b7e04bbf"], BOT), false);
  assert.equal(isYouTubeBotChallenge(["https://youtu.be/abcdefghijk"], BOT), true);
});

test("asking as another player type adds the argument once, in front, and keeps everything else", () => {
  assert.deepEqual(withYoutubeClient(YT, "tv"), ["--extractor-args", "youtube:player_client=tv", ...YT]);
  const already = ["--extractor-args", "youtube:player_client=mweb", ...YT];
  assert.deepEqual(withYoutubeClient(already, "tv"), already, "a client someone already chose is left alone");
});

test("the player types are tried in order and it stops at the first that works, saying which", async () => {
  const seen = []; const logs = [];
  const result = await tryYoutubeClients(YT, BOT, async (args) => {
    const client = args[1].split("=")[1];
    seen.push(client);
    if (client !== "tv_simply") throw new Error("still blocked");
    return "downloaded";
  }, { log: (l) => logs.push(l) });
  assert.deepEqual(result, { ok: true, value: "downloaded", client: "tv_simply" });
  assert.deepEqual(seen, ["android_vr", "tv_simply"], "stopped after the one that worked");
  assert.ok(logs.some((l) => /passed by asking as player client "tv_simply"/.test(l)));
  assert.ok(logs.some((l) => /"android_vr" did not get through/.test(l)));
});

test("if every player type is blocked it says so and reports failure so the original error is kept", async () => {
  const logs = [];
  const result = await tryYoutubeClients(YT, BOT, async () => { throw new Error("blocked"); }, { log: (l) => logs.push(l) });
  assert.deepEqual(result, { ok: false });
  assert.equal(logs.filter((l) => /did not get through/.test(l)).length, YOUTUBE_FALLBACK_CLIENTS.length);
  assert.ok(logs.at(-1).includes("every other player client failed too"));
});

test("nothing is tried for a failure that was not the bot check, or for another site", async () => {
  let calls = 0;
  const attempt = async () => { calls++; return "x"; };
  assert.deepEqual(await tryYoutubeClients(YT, "HTTP Error 429", attempt, { log: () => {} }), { ok: false });
  assert.deepEqual(await tryYoutubeClients(["https://www.twitch.tv/videos/1"], BOT, attempt, { log: () => {} }), { ok: false });
  assert.equal(calls, 0);
});

test("a shorter list can be given: the video-details lookup, which a person waits for, tries only two", async () => {
  const seen = [];
  await tryYoutubeClients(YT, BOT, async (args) => { seen.push(args[1].split("=")[1]); throw new Error("no"); }, { clients: YOUTUBE_FALLBACK_CLIENTS.slice(0, 2), log: () => {} });
  assert.deepEqual(seen, [YOUTUBE_FALLBACK_CLIENTS[0], YOUTUBE_FALLBACK_CLIENTS[1]]);
  assert.deepEqual([...YOUTUBE_FALLBACK_CLIENTS], ["android_vr", "tv_simply", "tv_embedded", "web_embedded", "mweb"]);
  for (const broken of ["tv", "web_safari", "web_creator", "web_music", "ios"]) assert.ok(!YOUTUBE_FALLBACK_CLIENTS.includes(broken), `${broken} fails even without a block`);
});

test("both yt-dlp runners use it only after the existing IPv6 retry, and log when IPv6 works", () => {
  const bin = read("lib/bin.ts");
  assert.match(bin, /import \{ tryYoutubeClients, YOUTUBE_FALLBACK_CLIENTS \} from "\.\/youtube-client-fallback\.ts";/);
  assert.equal((bin.match(/tryYoutubeClients\(/g) ?? []).length, 2);
  assert.match(bin, /YOUTUBE_FALLBACK_CLIENTS\.slice\(0, 2\)/);
  assert.match(bin, /passed over IPv6"\)/);
  assert.match(bin, /passed over IPv6 \(metadata\)/);
  // the order: the IPv6 retry first, then the other player types
  assert.ok(bin.indexOf('"--force-ipv6", ...args') < bin.indexOf("tryYoutubeClients(args, message, (clientArgs) => run("));
});
