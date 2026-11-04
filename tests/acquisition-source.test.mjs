import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cleanSource, sourceFromReferrer, sourceFromVisit, shouldSaveSource, DIRECT_SOURCE, UNKNOWN_SOURCE } from "../lib/acquisition-source.ts";
import { claimAcquisitionSource, NEW_ACCOUNT_WINDOW_MS } from "../lib/acquisition-claim.ts";
import { buildSourceReport, isAdminEmail, adminEmails, BEFORE_TRACKING } from "../lib/source-report.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");
const q = (s) => new URLSearchParams(s);

test("a source label is lowercase, short, and only safe characters", () => {
  assert.equal(cleanSource("TikTok"), "tiktok");
  assert.equal(cleanSource("  Meta Ads! "), "meta-ads");
  assert.equal(cleanSource("<script>alert(1)</script>"), "script-alert-1-script");
  assert.equal(cleanSource("a".repeat(80))?.length, 32);
  assert.equal(cleanSource(""), null);
  assert.equal(cleanSource("***"), null);
  assert.equal(cleanSource(null), null);
});

test("well-known referrer sites get friendly names and others show their domain", () => {
  assert.equal(sourceFromReferrer("https://www.tiktok.com/@someone", "www.klyp.world"), "tiktok");
  assert.equal(sourceFromReferrer("https://www.twitch.tv/somestreamer", "www.klyp.world"), "twitch");
  assert.equal(sourceFromReferrer("https://www.google.co.uk/", "www.klyp.world"), "google");
  assert.equal(sourceFromReferrer("https://t.co/abc", "www.klyp.world"), "x");
  assert.equal(sourceFromReferrer("https://l.facebook.com/l.php", "www.klyp.world"), "facebook");
  assert.equal(sourceFromReferrer("https://www.example-blog.com/post", "www.klyp.world"), "example-blog.com");
});

test("a visit from inside Klyp, or with no or a broken referrer, has no outside source", () => {
  assert.equal(sourceFromReferrer("https://www.klyp.world/login", "www.klyp.world"), null);
  assert.equal(sourceFromReferrer("https://klyp.world/", "www.klyp.world"), null);
  assert.equal(sourceFromReferrer("", "www.klyp.world"), null);
  assert.equal(sourceFromReferrer(null, "www.klyp.world"), null);
  assert.equal(sourceFromReferrer("not a url", "www.klyp.world"), null);
});

test("a tagged link beats the ad link, which beats the referrer, which beats direct", () => {
  assert.equal(sourceFromVisit(q("src=email1&offer=17"), "https://www.tiktok.com/", "www.klyp.world"), "email1");
  assert.equal(sourceFromVisit(q("utm_source=Newsletter"), null, "www.klyp.world"), "newsletter");
  assert.equal(sourceFromVisit(q("offer=17"), "https://www.tiktok.com/", "www.klyp.world"), "offer-17");
  assert.equal(sourceFromVisit(q(""), "https://www.tiktok.com/", "www.klyp.world"), "tiktok");
  assert.equal(sourceFromVisit(q(""), null, "www.klyp.world"), DIRECT_SOURCE);
  assert.equal(sourceFromVisit(q("offer=99"), null, "www.klyp.world"), DIRECT_SOURCE);
});

test("the first real source is kept, and only direct gets replaced by a real one", () => {
  assert.equal(shouldSaveSource(undefined, "direct"), true);
  assert.equal(shouldSaveSource("", "tiktok"), true);
  assert.equal(shouldSaveSource("direct", "tiktok"), true);
  assert.equal(shouldSaveSource("direct", "direct"), false);
  assert.equal(shouldSaveSource("tiktok", "twitch"), false);
  assert.equal(shouldSaveSource("tiktok", "direct"), false);
});

function fakeDb(profile) {
  const calls = { updates: [] };
  const db = { from: () => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profile, error: null }) }) }),
    update: (values) => ({ eq: (_c, id) => ({ is: async (col, v) => { calls.updates.push({ values, id, col, v }); return { error: null }; } }) }),
  }) };
  return { db, calls };
}
const now = Date.parse("2026-11-04T12:00:00Z");
const fresh = (over = {}) => ({ acquisition_source: null, created_at: new Date(now - 3600_000).toISOString(), ...over });

test("a new account without a source gets the cookie value saved, only into an empty column", async () => {
  const { db, calls } = fakeDb(fresh());
  assert.equal(await claimAcquisitionSource(db, "u1", "tiktok", now), "saved");
  assert.deepEqual(calls.updates, [{ values: { acquisition_source: "tiktok" }, id: "u1", col: "acquisition_source", v: null }]);
});

test("a new account with no cookie is saved as unknown, and a dirty cookie is cleaned", async () => {
  let t = fakeDb(fresh());
  assert.equal(await claimAcquisitionSource(t.db, "u1", undefined, now), "saved");
  assert.equal(t.calls.updates[0].values.acquisition_source, UNKNOWN_SOURCE);
  t = fakeDb(fresh());
  await claimAcquisitionSource(t.db, "u1", "TikTok<>", now);
  assert.equal(t.calls.updates[0].values.acquisition_source, "tiktok");
});

test("an account that already has a source, or is older than two days, or has no profile is left alone", async () => {
  let t = fakeDb(fresh({ acquisition_source: "twitch" }));
  assert.equal(await claimAcquisitionSource(t.db, "u1", "tiktok", now), "already-set");
  assert.equal(t.calls.updates.length, 0);
  t = fakeDb(fresh({ created_at: new Date(now - NEW_ACCOUNT_WINDOW_MS - 1000).toISOString() }));
  assert.equal(await claimAcquisitionSource(t.db, "u1", "tiktok", now), "too-old");
  assert.equal(t.calls.updates.length, 0);
  t = fakeDb(null);
  assert.equal(await claimAcquisitionSource(t.db, "u1", "tiktok", now), "no-profile");
});

test("the source report counts signups, people who ran a VOD, and paying customers per source", () => {
  const profiles = [
    { id: "a", acquisition_source: "tiktok", stripe_subscription_id: "sub_1" },
    { id: "b", acquisition_source: "tiktok", stripe_subscription_id: null },
    { id: "c", acquisition_source: "meta", stripe_subscription_id: null },
    { id: "d", acquisition_source: null, stripe_subscription_id: null },
    { id: "e", acquisition_source: null, stripe_subscription_id: null },
    { id: "f", acquisition_source: "direct", stripe_subscription_id: null },
  ];
  const rows = buildSourceReport(profiles, ["a", "c", "d", "d", "zzz"]);
  assert.deepEqual(rows, [
    { source: "tiktok", signups: 2, ranVod: 1, paid: 1 },
    { source: "direct", signups: 1, ranVod: 0, paid: 0 },
    { source: "meta", signups: 1, ranVod: 1, paid: 0 },
    { source: BEFORE_TRACKING, signups: 2, ranVod: 1, paid: 0 },
  ]);
});

test("only listed emails can open the Sources page, and an empty list means nobody", () => {
  assert.deepEqual(adminEmails(" A@x.com , b@y.com ,"), ["a@x.com", "b@y.com"]);
  assert.equal(isAdminEmail("A@X.com", "a@x.com,b@y.com"), true);
  assert.equal(isAdminEmail("c@z.com", "a@x.com"), false);
  assert.equal(isAdminEmail("a@x.com", ""), false);
  assert.equal(isAdminEmail("a@x.com", undefined), false);
  assert.equal(isAdminEmail(null, "a@x.com"), false);
});

test("the proxy saves the source on public and dashboard pages, and the dashboard claims it once", () => {
  const proxy = read("proxy.ts");
  assert.match(proxy, /saveSource\(request, response\)/);
  assert.match(proxy, /saveSource\(request, supabaseResponse\)/);
  assert.match(proxy, /httpOnly: true/);
  assert.match(read("app/(dashboard)/layout.tsx"), /<AttributionClaim \/>/);
  assert.match(read("app/api/attribution/route.ts"), /auth\.getUser\(\)/);
  assert.match(read("app/(dashboard)/dashboard/sources/page.tsx"), /notFound\(\)/);
  assert.match(read("supabase/migrations/044_acquisition_source.sql"), /add column if not exists acquisition_source/);
});
