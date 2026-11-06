import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dueKind, isEmailable, FIRST_AFTER_MS, SECOND_AFTER_MS } from "../lib/activation-email-rules.ts";
import { buildActivationEmail } from "../lib/activation-email-content.ts";
import { signUnsubscribe, verifyUnsubscribe, unsubscribeUrl } from "../lib/activation-unsubscribe.ts";
import { runActivationEmails } from "../lib/activation-email-run.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");
const NOW = Date.parse("2026-11-06T12:00:00Z");
const minutesAgo = (m) => new Date(NOW - m * 60_000).toISOString();
const profile = (over = {}) => ({ created_at: minutesAgo(12), activation_email_1_at: null, activation_email_2_at: null, activation_emails_off: false, ...over });

test("email 1 is due from 10 minutes after signup, not before, and not for stale signups", () => {
  assert.equal(dueKind({ profile: profile({ created_at: minutesAgo(9) }), ranVideo: false, now: NOW }), null);
  assert.equal(dueKind({ profile: profile({ created_at: minutesAgo(10) }), ranVideo: false, now: NOW }), "first");
  assert.equal(dueKind({ profile: profile({ created_at: minutesAgo(300) }), ranVideo: false, now: NOW }), "first");
  assert.equal(dueKind({ profile: profile({ created_at: minutesAgo(7 * 60) }), ranVideo: false, now: NOW }), null);
  assert.equal(FIRST_AFTER_MS, 10 * 60_000);
});

test("email 2 is due at 24 hours, only after email 1, and only once", () => {
  const sent1 = { activation_email_1_at: minutesAgo(1400) };
  assert.equal(dueKind({ profile: profile({ ...sent1, created_at: minutesAgo(23 * 60) }), ranVideo: false, now: NOW }), null);
  assert.equal(dueKind({ profile: profile({ ...sent1, created_at: minutesAgo(25 * 60) }), ranVideo: false, now: NOW }), "second");
  assert.equal(dueKind({ profile: profile({ ...sent1, activation_email_2_at: minutesAgo(5), created_at: minutesAgo(25 * 60) }), ranVideo: false, now: NOW }), null);
  assert.equal(dueKind({ profile: profile({ created_at: minutesAgo(25 * 60) }), ranVideo: false, now: NOW }), null, "never jumps straight to email 2");
  assert.equal(SECOND_AFTER_MS, 24 * 3600_000);
});

test("nothing is sent to someone who ran a video or unsubscribed", () => {
  assert.equal(dueKind({ profile: profile(), ranVideo: true, now: NOW }), null);
  assert.equal(dueKind({ profile: profile({ activation_emails_off: true }), ranVideo: false, now: NOW }), null);
});

test("test and throwaway addresses are never emailed", () => {
  for (const bad of ["a@klyp.world", "x@example.com", "x@playfine.com", "x@mailinator.com", "x@sub.yopmail.com", "", null, undefined, "nope"]) assert.equal(isEmailable(bad), false, String(bad));
  for (const ok of ["person@gmail.com", "x@icloud.com", "x@hotmail.com"]) assert.equal(isEmailable(ok), true, ok);
});

test("the emails say what was approved and carry the dashboard and unsubscribe links", () => {
  const links = { dashboardUrl: "https://www.klyp.world/dashboard?src=email_new1", unsubscribeUrl: "https://www.klyp.world/api/activation-unsubscribe?u=1&t=2" };
  const one = buildActivationEmail("first", links);
  assert.equal(one.subject, "You're in. Your 60 free Sparks are ready");
  assert.match(one.text, /Welcome to Klyp\. Your 60 free Sparks are ready\./);
  assert.match(one.text, /Paste a Twitch, Kick, or YouTube link\./);
  assert.doesNotMatch(one.text + one.html, /haven't used|haven't clipped/);
  const two = buildActivationEmail("second", links);
  assert.equal(two.subject, "Got a VOD sitting around?");
  assert.match(two.text, /just reply and tell us/);
  for (const mail of [one, two]) {
    assert.ok(mail.html.includes("https://www.klyp.world/dashboard?src=email_new") && mail.text.includes(links.dashboardUrl));
    assert.ok(mail.html.includes("api/activation-unsubscribe") && mail.text.includes(links.unsubscribeUrl), "unsubscribe link in both versions");
    assert.ok(mail.html.includes("Clip my first video"));
  }
});

test("unsubscribe links only work with the code we signed for that account", () => {
  const id = "0bc1a185-33da-497c-88e7-bd4f568e3f7a";
  const other = "08546cf3-ec3e-443e-9797-968731d001d0";
  const token = signUnsubscribe(id, "s3cret");
  assert.equal(verifyUnsubscribe(id, token, "s3cret"), true);
  assert.equal(verifyUnsubscribe(other, token, "s3cret"), false, "a code is for one account");
  assert.equal(verifyUnsubscribe(id, token, "different"), false);
  assert.equal(verifyUnsubscribe(id, "x".repeat(32), "s3cret"), false);
  assert.equal(verifyUnsubscribe(id, token, undefined), false, "no secret means nothing is valid");
  assert.equal(verifyUnsubscribe("not-an-id", token, "s3cret"), false);
  assert.match(unsubscribeUrl("https://www.klyp.world/", id, "s3cret"), /^https:\/\/www\.klyp\.world\/api\/activation-unsubscribe\?u=.+&t=[0-9a-f]{32}$/);
});

function harness({ candidates, ran = [], addresses = {}, claimFails = [], sendFails = false } = {}) {
  const sent = []; const claimed = []; const released = []; const logs = [];
  const deps = {
    now: () => NOW,
    log: (m) => logs.push(m),
    listCandidates: async (kind) => candidates[kind] ?? [],
    ranVideo: async () => new Set(ran),
    getAddress: async (id) => addresses[id] ?? { email: `${id.slice(0, 4)}@gmail.com`, confirmed: true },
    claim: async (id, kind) => { if (claimFails.includes(id)) return false; claimed.push(`${id}:${kind}`); return true; },
    release: async (id, kind) => { released.push(`${id}:${kind}`); },
    send: async (mail) => { if (sendFails) throw new Error("boom"); sent.push(mail); },
  };
  return { deps, sent, claimed, released, logs };
}
const opts = { mode: "on", siteUrl: "https://www.klyp.world", secret: "s3cret" };
const cand = (id, over = {}) => ({ id, ...profile(over) });

test("a pass sends email 1 once, with tagged links, and marks the account first", async () => {
  const h = harness({ candidates: { first: [cand("aaaa1111-0000-4000-8000-000000000001")] } });
  const summary = await runActivationEmails(h.deps, opts);
  assert.deepEqual(summary, { sent: 1, wouldSend: 0, skipped: 0, failed: 0 });
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].subject, "You're in. Your 60 free Sparks are ready");
  assert.ok(h.sent[0].html.includes("src=email_new1"));
  assert.deepEqual(h.claimed, ["aaaa1111-0000-4000-8000-000000000001:first"]);
});

test("a pass skips people who ran a video, unconfirmed addresses and test addresses", async () => {
  const a = "aaaa1111-0000-4000-8000-00000000000a", b = "aaaa1111-0000-4000-8000-00000000000b", c = "aaaa1111-0000-4000-8000-00000000000c", d = "aaaa1111-0000-4000-8000-00000000000d";
  const h = harness({
    candidates: { first: [cand(a), cand(b), cand(c), cand(d)] }, ran: [a],
    addresses: { [b]: { email: "x@gmail.com", confirmed: false }, [c]: { email: "t@example.com", confirmed: true } },
  });
  const summary = await runActivationEmails(h.deps, opts);
  assert.equal(summary.sent, 1);
  assert.equal(summary.skipped, 3);
  assert.deepEqual(h.claimed, [`${d}:first`]);
});

test("dry mode sends nothing and marks nothing", async () => {
  const h = harness({ candidates: { first: [cand("aaaa1111-0000-4000-8000-000000000001")] } });
  const summary = await runActivationEmails(h.deps, { ...opts, mode: "dry" });
  assert.deepEqual(summary, { sent: 0, wouldSend: 1, skipped: 0, failed: 0 });
  assert.equal(h.sent.length, 0);
  assert.equal(h.claimed.length, 0);
});

test("if another run already claimed the account, no second email goes out", async () => {
  const id = "aaaa1111-0000-4000-8000-000000000001";
  const h = harness({ candidates: { first: [cand(id)] }, claimFails: [id] });
  const summary = await runActivationEmails(h.deps, opts);
  assert.equal(summary.sent, 0);
  assert.equal(h.sent.length, 0);
});

test("a failed send takes the mark back off so the next pass retries", async () => {
  const id = "aaaa1111-0000-4000-8000-000000000001";
  const h = harness({ candidates: { first: [cand(id)] }, sendFails: true });
  const summary = await runActivationEmails(h.deps, opts);
  assert.equal(summary.failed, 1);
  assert.deepEqual(h.released, [`${id}:first`]);
});

test("email 2 only goes to accounts that got email 1 and still have not run a video", async () => {
  const id = "aaaa1111-0000-4000-8000-000000000002";
  const second = cand(id, { created_at: minutesAgo(25 * 60), activation_email_1_at: minutesAgo(1400) });
  const h = harness({ candidates: { second: [second] } });
  const summary = await runActivationEmails(h.deps, opts);
  assert.equal(summary.sent, 1);
  assert.equal(h.sent[0].subject, "Got a VOD sitting around?");
  assert.ok(h.sent[0].html.includes("src=email_new2"));
});

test("the migration marks existing accounts as already emailed, only the first time", () => {
  const sql = read("supabase/migrations/046_activation_emails.sql");
  assert.match(sql, /activation_email_1_at timestamptz/);
  assert.match(sql, /activation_emails_off boolean not null default false/);
  assert.match(sql, /update public\.profiles set activation_email_1_at = now\(\), activation_email_2_at = now\(\)/);
  assert.match(sql, /if not exists \(\s*select 1 from information_schema\.columns/, "marking happens only when the columns are first added");
});

test("the worker is off unless asked, runs on the processing service, and the unsubscribe page checks the signature", () => {
  const worker = read("lib/activation-email-worker.ts");
  assert.match(worker, /mode !== "on" && mode !== "dry"\) return;/);
  assert.match(worker, /ACTIVATION_EMAIL_SECRET is not set/);
  assert.match(worker, /RESEND_API_KEY is not set/);
  const instr = read("instrumentation.ts");
  assert.ok(instr.indexOf("startActivationEmailWorker") > instr.indexOf('DEPLOYMENT_TARGET === "processing"'));
  const route = read("app/api/activation-unsubscribe/route.ts");
  assert.match(route, /verifyUnsubscribe\(userId, token, secret\)/);
  assert.match(route, /activation_emails_off: true/);
});
