import test from "node:test";
import assert from "node:assert/strict";
import { isArchivableSource } from "../lib/clip-archive-source.ts";

test("archive worker accepts supported VODs and uploaded IDs only", () => {
  assert.equal(isArchivableSource("https://www.youtube.com/watch?v=abc123def45"), true);
  assert.equal(isArchivableSource("https://www.twitch.tv/videos/123456"), true);
  assert.equal(isArchivableSource("upload:550e8400-e29b-41d4-a716-446655440000"), true);
  for (const source of [
    "http://127.0.0.1:3000/secrets",
    "http://169.254.169.254/latest/meta-data/",
    "https://youtube.com.evil.test/watch?v=abc123def45",
    "file:///etc/passwd",
    "upload:../../secrets",
  ]) assert.equal(isArchivableSource(source), false, source);
});
