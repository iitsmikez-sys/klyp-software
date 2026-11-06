import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tallyAudience, shouldAskAudience, isStoredAudience, AUDIENCE_OPTIONS, AUDIENCE_KEY } from "../lib/clip-audience.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");
const now = Date.parse("2026-11-05T12:00:00Z");
const daysAgo = (d) => new Date(now - d * 86_400_000).toISOString();

test("a new account that has not answered is asked", () => {
  assert.equal(shouldAskAudience({ created_at: daysAgo(0.1), user_metadata: {} }, now), true);
  assert.equal(shouldAskAudience({ created_at: daysAgo(6), user_metadata: null }, now), true);
});

test("answered or skipped accounts are never asked again", () => {
  for (const v of ["own", "others", "both", "skipped"]) {
    assert.equal(shouldAskAudience({ created_at: daysAgo(1), user_metadata: { [AUDIENCE_KEY]: v } }, now), false);
  }
});

test("old accounts, signed-out visitors and bad dates are left alone", () => {
  assert.equal(shouldAskAudience({ created_at: daysAgo(8), user_metadata: {} }, now), false);
  assert.equal(shouldAskAudience(null, now), false);
  assert.equal(shouldAskAudience({ user_metadata: {} }, now), false);
  assert.equal(shouldAskAudience({ created_at: "nonsense", user_metadata: {} }, now), false);
});

test("a junk stored value does not count as an answer", () => {
  assert.equal(isStoredAudience("maybe"), false);
  assert.equal(shouldAskAudience({ created_at: daysAgo(1), user_metadata: { [AUDIENCE_KEY]: "maybe" } }, now), true);
  assert.deepEqual(AUDIENCE_OPTIONS.map((o) => o.value), ["own", "others", "both"]);
});

test("the dashboard shows the question and the screen saves the answer to the account", () => {
  assert.ok(read("app/(dashboard)/dashboard/page.tsx").includes("<AudienceQuestion />"));
  const ui = read("components/AudienceQuestion.tsx");
  assert.ok(ui.includes("auth.updateUser({ data: { [AUDIENCE_KEY]: value } })"));
  assert.ok(ui.includes('answer("skipped")') && ui.includes("Whose videos will you clip?") && ui.includes("Skip for now"));
});

test("the Sources page adds up the answers, counting junk and missing values as unanswered", () => {
  const meta = (v) => ({ user_metadata: v === undefined ? {} : { [AUDIENCE_KEY]: v } });
  const tally = tallyAudience([meta("own"), meta("others"), meta("others"), meta("both"), meta("skipped"), meta(), meta("maybe"), { user_metadata: null }]);
  assert.deepEqual(tally, { own: 1, others: 2, both: 1, skipped: 1, unanswered: 3 });
  assert.ok(read("app/(dashboard)/dashboard/sources/page.tsx").includes("tallyAudience(accounts)"));
});
