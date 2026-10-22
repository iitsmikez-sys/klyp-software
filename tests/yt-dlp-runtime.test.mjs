import assert from "node:assert/strict";
import test from "node:test";
import * as bin from "../lib/bin.ts";

test("yt-dlp explicitly enables the Node runtime needed for YouTube extraction", () => {
  assert.equal(typeof bin.ytDlpRuntimeArgs, "function");
  assert.deepEqual(bin.ytDlpRuntimeArgs(), ["--js-runtimes", "node"]);
});
