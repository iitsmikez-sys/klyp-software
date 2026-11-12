import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");

async function loadSwitch(value) {
  const before = process.env.NEXT_PUBLIC_YOUTUBE_ENABLED;
  if (value === undefined) delete process.env.NEXT_PUBLIC_YOUTUBE_ENABLED; else process.env.NEXT_PUBLIC_YOUTUBE_ENABLED = value;
  try { return await import(`../lib/youtube-switch.ts?case=${String(value)}`); }
  finally { if (before === undefined) delete process.env.NEXT_PUBLIC_YOUTUBE_ENABLED; else process.env.NEXT_PUBLIC_YOUTUBE_ENABLED = before; }
}

test("YouTube is off unless NEXT_PUBLIC_YOUTUBE_ENABLED is exactly 1", async () => {
  assert.equal((await loadSwitch(undefined)).YOUTUBE_ENABLED, false);
  assert.equal((await loadSwitch("0")).YOUTUBE_ENABLED, false);
  assert.equal((await loadSwitch("1")).YOUTUBE_ENABLED, true);
});

test("the switch recognises YouTube links only", async () => {
  const { YOUTUBE_LINK } = await loadSwitch(undefined);
  for (const url of ["https://www.youtube.com/watch?v=abcdefghijk", "https://youtu.be/abcdefghijk", "https://m.youtube.com/watch?v=abcdefghijk"]) assert.ok(YOUTUBE_LINK.test(url), url);
  for (const url of ["https://www.twitch.tv/videos/123", "https://kick.com/video/abc", "https://notyoutube.com/x"]) assert.ok(!YOUTUBE_LINK.test(url), url);
});

test("the page copy follows the switch", async () => {
  assert.equal((await loadSwitch(undefined)).VOD_SITES, "Twitch and Kick");
  assert.equal((await loadSwitch("1")).VOD_SITES, "YouTube, Twitch and Kick");
});

test("both server routes refuse YouTube links when it is off, before any sign-in lookup or charge", () => {
  const analyze = read("app/api/analyze/route.ts");
  assert.match(analyze, /const YOUTUBE_ON = process\.env\.NEXT_PUBLIC_YOUTUBE_ENABLED === "1";/);
  assert.ok(analyze.indexOf("!YOUTUBE_ON && YOUTUBE_LINK.test(url)") > 0);
  assert.ok(analyze.indexOf("!YOUTUBE_ON && YOUTUBE_LINK.test(url)") < analyze.indexOf("const token = bearerToken(req);"), "refused before the account lookup");
  const duration = read("app/api/duration/route.ts");
  assert.ok(duration.indexOf("!YOUTUBE_ON && YOUTUBE_LINK.test(url)") < duration.indexOf("const token = bearerToken(req);"));
  for (const src of [analyze, duration]) assert.ok(src.includes("YouTube links aren't supported right now. Paste a Twitch or Kick VOD link instead. No Sparks are charged."));
});

test("the paste box stops accepting YouTube and says so right away when one is pasted", () => {
  const panel = read("components/AnalyzePanel.tsx");
  assert.match(panel, /const VOD_URL_PATTERN = YOUTUBE_ENABLED\s*\?/);
  assert.ok(panel.includes("YOUTUBE_LINK.test(url) ? YOUTUBE_OFF_MESSAGE"));
  assert.ok(panel.includes('"Use a Twitch or Kick VOD link to get started."'));
  const hint = read("components/PasteBoxHint.tsx");
  assert.ok(hint.includes('YOUTUBE_ENABLED || platform.name !== "YouTube"'));
});

test("the landing page, FAQ, plan lists and page title stop naming YouTube as a source when it is off", () => {
  for (const f of ["components/landing/LandingPage.tsx", "components/FAQ.tsx", "app/layout.tsx", "lib/plan-features.ts"]) {
    assert.ok(read(f).includes("YOUTUBE_ENABLED"), f);
  }
});
