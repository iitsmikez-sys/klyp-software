import assert from "node:assert/strict";
import { test } from "node:test";
import { ownClipArchivePath } from "../lib/clip-archive-path.ts";

test("only the clip's own archived objects are accepted", () => {
  const user = "11111111-1111-4111-8111-111111111111";
  const clip = "22222222-2222-4222-8222-222222222222";
  const other = "33333333-3333-4333-8333-333333333333";
  assert.equal(ownClipArchivePath(`${user}/${clip}/master.mp4`, user, clip, "master"), `${user}/${clip}/master.mp4`);
  assert.equal(ownClipArchivePath(`${other}/${clip}/master.mp4`, user, clip, "master"), null);
  assert.equal(ownClipArchivePath(`${user}/${other}/master.mp4`, user, clip, "master"), null);
  assert.equal(ownClipArchivePath(`${user}/${clip}/proxy.mp4`, user, clip, "master"), null);
  assert.equal(ownClipArchivePath(`${user}/${clip}/../${other}/master.mp4`, user, clip, "master"), null);
});
