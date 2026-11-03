import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

test("the Upgrade page offers the three packs and starts a pack checkout, with no per-Spark cents shown", async () => {
  const page = await read("app/(dashboard)/dashboard/upgrade/page.tsx");
  assert.match(page, /Need more Sparks\?/);
  assert.match(page, /SPARK_PACKS\.map/);
  assert.match(page, /fetch\("\/api\/stripe\/packs"/);
  assert.match(page, /JSON\.stringify\(\{ pack: packId \}\)/);
  assert.match(page, /Bought Sparks never expire/);
  assert.match(page, /id="packs"/);
  assert.doesNotMatch(page, /¢|cents? each|each\b.*Spark/i);
});

test("Settings links to the packs and shows the bought Sparks when there are any", async () => {
  const page = await read("app/(dashboard)/dashboard/settings/page.tsx");
  assert.match(page, /href="\/dashboard\/upgrade#packs"/);
  assert.match(page, /Buy more Sparks/);
  assert.match(page, /pack_sparks/);
  assert.match(page, /bought Sparks/);
});

test("coming back from a pack checkout refreshes the balance (and repairs a missed webhook)", async () => {
  const provider = await read("components/SparksProvider.tsx");
  assert.match(provider, /get\("pack"\) !== "1"/);
  assert.match(provider, /\/api\/stripe\/sync/);
  const sync = await read("app/api/stripe/sync/route.ts");
  assert.match(sync, /syncSparkPacks/);
});

test("the unproven 'make this back in 1 viral clip' claim is gone from the Upgrade page", async () => {
  const page = await read("app/(dashboard)/dashboard/upgrade/page.tsx");
  assert.doesNotMatch(page, /make this back/i);
  assert.doesNotMatch(page, /viral clip/i);
});
