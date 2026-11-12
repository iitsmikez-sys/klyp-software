import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");
const landing = read("components/landing/LandingPage.tsx");

test("the landing page says 100+ streamers, the same count the upgrade page uses", () => {
  assert.match(landing, /Join <span className="font-semibold text-foreground">100\+ streamers<\/span> clipping with Klyp/);
});

test("the $17 first-month line shows only when the offer is open to every new subscriber", () => {
  assert.match(landing, /\{firstMonthForAll && \(/);
  assert.equal((landing.match(/\$17/g) ?? []).length, 1, "the $17 appears once, inside that condition");
  assert.match(read("app/page.tsx"), /firstMonthForAll=\{\(process\.env\.FIRST_MONTH_OFFER \?\? ""\)\.trim\(\)\.toLowerCase\(\) === "all"\}/);
});
