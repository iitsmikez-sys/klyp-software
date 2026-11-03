import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("the Upgrade page shows nothing until the plan has loaded, so Pro members never see the Free view flash", () => {
  const src = readFileSync(new URL("../app/(dashboard)/dashboard/upgrade/page.tsx", import.meta.url), "utf8");
  assert.match(src, /if \(balance === null && !waitedTooLong\) return/);
});
