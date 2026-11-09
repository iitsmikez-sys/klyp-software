import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { acquireUserProcessingSlot } from "../lib/clip-access-core.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");

test("frame and preview jobs filling the account's 3 slots no longer block a Download", () => {
  const user = "user-slots-1";
  const shared = [1, 2, 3].map(() => acquireUserProcessingSlot(user));
  assert.ok(shared.every(Boolean));
  assert.equal(acquireUserProcessingSlot(user), null, "a 4th frame/preview job waits, as before");
  const a = acquireUserProcessingSlot(user, { scope: "export", max: 2 });
  const b = acquireUserProcessingSlot(user, { scope: "export", max: 2 });
  assert.ok(a && b, "two downloads still get through");
  assert.equal(acquireUserProcessingSlot(user, { scope: "export", max: 2 }), null, "a third at once is refused");
  a(); assert.ok(acquireUserProcessingSlot(user, { scope: "export", max: 2 }), "a finished download frees its slot");
  shared.forEach((release) => release());
});

test("one person's downloads never use up another person's slots", () => {
  const a1 = acquireUserProcessingSlot("slots-a", { scope: "export", max: 2 });
  const a2 = acquireUserProcessingSlot("slots-a", { scope: "export", max: 2 });
  assert.equal(acquireUserProcessingSlot("slots-a", { scope: "export", max: 2 }), null);
  assert.ok(acquireUserProcessingSlot("slots-b", { scope: "export", max: 2 }));
  a1(); a2();
});

test("the clip route uses the download budget, and the page loads frames only two at a time", () => {
  assert.ok(read("app/api/clip/route.ts").includes('acquireUserProcessingSlot(profile.id, { scope: "export", max: 2 })'));
  const thumbs = read("lib/clip-thumbnails.ts");
  assert.ok(thumbs.includes("const MAX_CONCURRENT_FRAMES = 2;"));
  assert.ok(thumbs.includes("acquireFrameTurn().then((release) => fetchThumbnail(clip, key).finally(release))"));
  assert.ok(thumbs.includes("}, 45_000);"), "the 45 second clock still applies once a frame's turn starts");
});
