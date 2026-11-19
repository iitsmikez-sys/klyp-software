import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("the Upgrade page shows nothing until the plan has loaded, so Pro members never see the Free view flash", () => {
  const src = readFileSync(new URL("../app/(dashboard)/dashboard/upgrade/page.tsx", import.meta.url), "utf8");
  assert.match(src, /if \(\(balance === null \|\| \(!isPro && !offerReady\)\) && !waitedTooLong\) return/);
  assert.match(src, /\.finally\(\(\) => \{ if \(!cancelled\) setOfferReady\(true\); \}\)/, "the price waits for the offer lookup, so $276 a year never flashes before the $3 pass");
});
