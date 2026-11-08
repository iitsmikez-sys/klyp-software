import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { returnDue, RETURN_AFTER_MS, RETURN_UNTIL_MS, MIN_SPARKS_TO_RUN_ANOTHER } from "../lib/return-email-rules.ts";
import { buildReturnEmail } from "../lib/return-email-content.ts";
import { signReason, verifyReason, reasonUrl, RETURN_REASONS, isReturnReason } from "../lib/return-feedback.ts";
import { runReturnEmails } from "../lib/return-email-run.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");
const NOW = Date.parse("2026-11-08T12:00:00Z");
const hoursAgo = (h) => new Date(NOW - h * 3_600_000).toISOString();
const profile = (over = {}) => ({ tier: "free", stripe_subscription_id: null, sparks: 40, return_email_at: null, activation_emails_off: false, ...over });
const done = (h = 60) => ({ status: "completed", created_at: hoursAgo(h + 0.1), updated_at: hoursAgo(h) });
const USER = "0bc1a185-33da-497c-88e7-bd4f568e3f7a";

test("someone whose only video finished 2 to 4 days ago, on Free with Sparks left, is due", () => {
  const due = returnDue({ profile: profile(), analyses: [done(60)], now: NOW });
  assert.ok(due);
  assert.equal(due.daysLeft, 3, "5 day results, finished 2.5 days ago: 3 whole days left");
  assert.equal(RETURN_AFTER_MS, 48 * 3_600_000);
  assert.equal(RETURN_UNTIL_MS, 96 * 3_600_000);
});

test("too early, too late, or never finished means no email", () => {
  assert.equal(returnDue({ profile: profile(), analyses: [done(47)], now: NOW }), null);
  assert.ok(returnDue({ profile: profile(), analyses: [done(49)], now: NOW }));
  assert.ok(returnDue({ profile: profile(), analyses: [done(95)], now: NOW }));
  assert.equal(returnDue({ profile: profile(), analyses: [done(97)], now: NOW }), null);
  assert.equal(returnDue({ profile: profile(), analyses: [{ status: "failed", created_at: hoursAgo(60), updated_at: hoursAgo(60) }], now: NOW }), null);
  assert.equal(returnDue({ profile: profile(), analyses: [], now: NOW }), null);
});

test("anyone who came back is left alone: a second finished video, or any newer attempt", () => {
  assert.equal(returnDue({ profile: profile(), analyses: [done(80), done(60)], now: NOW }), null, "two finished videos");
  const newer = { status: "failed", created_at: hoursAgo(50), updated_at: hoursAgo(50) };
  assert.equal(returnDue({ profile: profile(), analyses: [done(60), newer], now: NOW }), null, "a newer failed attempt means they came back");
  const older = { status: "failed", created_at: hoursAgo(70), updated_at: hoursAgo(70) };
  assert.ok(returnDue({ profile: profile(), analyses: [older, done(60)], now: NOW }), "an older failed attempt before the finished one does not count");
});

test("Pro, unsubscribed, already emailed, or too few Sparks to run another video: no email", () => {
  assert.equal(returnDue({ profile: profile({ tier: "pro" }), analyses: [done()], now: NOW }), null);
  assert.equal(returnDue({ profile: profile({ stripe_subscription_id: "sub_1" }), analyses: [done()], now: NOW }), null);
  assert.equal(returnDue({ profile: profile({ activation_emails_off: true }), analyses: [done()], now: NOW }), null);
  assert.equal(returnDue({ profile: profile({ return_email_at: hoursAgo(1) }), analyses: [done()], now: NOW }), null);
  assert.equal(returnDue({ profile: profile({ sparks: MIN_SPARKS_TO_RUN_ANOTHER - 1 }), analyses: [done()], now: NOW }), null);
  assert.ok(returnDue({ profile: profile({ sparks: MIN_SPARKS_TO_RUN_ANOTHER }), analyses: [done()], now: NOW }));
  assert.equal(MIN_SPARKS_TO_RUN_ANOTHER, 20);
});

const links = {
  dashboardUrl: "https://www.klyp.world/dashboard?src=email_return",
  unsubscribeUrl: "https://www.klyp.world/api/activation-unsubscribe?u=1&t=2",
  reasonLinks: RETURN_REASONS.map((r) => ({ key: r.key, label: r.label, url: `https://www.klyp.world/api/return-feedback?u=1&r=${r.key}&t=x` })),
};
const data = { clipCount: 8, bestTitle: "Cops thought his BREAD was drugs", bestScore: 78.6, bestSeconds: 34, daysLeft: 3, sparksLeft: 40 };

test("the email names their best clip and score, the days left and Sparks, and carries every link", () => {
  const mail = buildReturnEmail(data, links);
  assert.equal(mail.subject, "Your best Klyp clip scored 79");
  assert.equal(mail.previewText, "You still have 40 Sparks to use.");
  assert.match(mail.text, /Klyp found 8 moments in your video\. The best one:/);
  assert.match(mail.text, /"Cops thought his BREAD was drugs"/);
  assert.match(mail.text, /Score 79\. 0:34\./);
  assert.match(mail.text, /saved for 3 more days\. You also still have 40 Sparks/);
  for (const [part, enc] of [[mail.html, (u) => u.replaceAll("&", "&amp;")], [mail.text, (u) => u]]) {
    assert.ok(part.includes(enc(links.dashboardUrl)) && part.includes(enc(links.unsubscribeUrl)));
    for (const r of RETURN_REASONS) assert.ok(part.includes(r.label) && part.includes(`r=${r.key}`), r.key);
  }
  assert.ok(mail.html.includes("See my clips") && mail.html.includes("Or run another video"));
  assert.match(mail.html, /Tell us why in one click/);
  assert.match(mail.html, /reply to this email/i);
});

test("singular wording is right, and a title is never allowed to break the email", () => {
  const one = buildReturnEmail({ ...data, clipCount: 1, daysLeft: 1 }, links);
  assert.match(one.text, /found 1 moment in your video/);
  assert.match(one.text, /saved for 1 more day\./);
  const evil = buildReturnEmail({ ...data, bestTitle: '<script>alert(1)</script> "x" \n\u0000 & more' }, links);
  assert.ok(!evil.html.includes("<script>"));
  assert.ok(evil.html.includes("&lt;script&gt;"));
  assert.ok(!/[\u0000-\u0008]/.test(evil.html + evil.text));
});

test("one-click answers only work with the code we signed, for that account and that answer", () => {
  const token = signReason(USER, "slow", "s3cret");
  assert.equal(verifyReason(USER, "slow", token, "s3cret"), true);
  assert.equal(verifyReason(USER, "cuts", token, "s3cret"), false, "a code is for one answer");
  assert.equal(verifyReason("08546cf3-ec3e-443e-9797-968731d001d0", "slow", token, "s3cret"), false, "a code is for one account");
  assert.equal(verifyReason(USER, "slow", token, "different"), false);
  assert.equal(verifyReason(USER, "slow", "x".repeat(32), "s3cret"), false);
  assert.equal(verifyReason(USER, "slow", token, undefined), false);
  assert.equal(verifyReason(USER, "not-a-reason", token, "s3cret"), false);
  assert.equal(verifyReason("not-an-id", "slow", token, "s3cret"), false);
  assert.match(reasonUrl("https://www.klyp.world/", USER, "missed", "s3cret"), /^https:\/\/www\.klyp\.world\/api\/return-feedback\?u=.+&r=missed&t=[0-9a-f]{32}$/);
  assert.deepEqual(RETURN_REASONS.map((r) => r.key), ["not_good", "missed", "cuts", "slow", "looking"]);
  assert.equal(isReturnReason("slow"), true);
  assert.equal(isReturnReason("nope"), false);
});

function harness({ candidates, best = { count: 5, title: "A clip", score: 70, seconds: 25 }, addresses = {}, claimFails = [], sendFails = false } = {}) {
  const sent = []; const claimed = []; const released = []; const logs = [];
  const deps = {
    now: () => NOW,
    log: (m) => logs.push(m),
    listCandidates: async () => candidates,
    loadBestClip: async () => best,
    getAddress: async (id) => addresses[id] ?? { email: `${id.slice(0, 4)}@gmail.com`, confirmed: true },
    claim: async (id) => { if (claimFails.includes(id)) return false; claimed.push(id); return true; },
    release: async (id) => { released.push(id); },
    send: async (mail) => { if (sendFails) throw new Error("boom"); sent.push(mail); },
  };
  return { deps, sent, claimed, released, logs };
}
const opts = { mode: "on", siteUrl: "https://www.klyp.world", secret: "s3cret" };
const cand = (id, over = {}) => ({ id, profile: profile(over), analyses: [done(60)] });
const A = "aaaa1111-0000-4000-8000-000000000001";
const B = "aaaa1111-0000-4000-8000-000000000002";

test("a pass emails a due account once, marks it first, and signs every link for that account", async () => {
  const h = harness({ candidates: [cand(A)] });
  const summary = await runReturnEmails(h.deps, opts);
  assert.deepEqual(summary, { sent: 1, wouldSend: 0, skipped: 0, failed: 0 });
  assert.deepEqual(h.claimed, [A]);
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].subject, "Your best Klyp clip scored 70");
  assert.ok(h.sent[0].html.includes(`r=not_good&amp;t=${signReason(A, "not_good", "s3cret")}`));
  assert.ok(h.sent[0].html.includes("src=email_return"));
});

test("dry mode sends nothing and marks nothing", async () => {
  const h = harness({ candidates: [cand(A)] });
  const summary = await runReturnEmails(h.deps, { ...opts, mode: "dry" });
  assert.deepEqual(summary, { sent: 0, wouldSend: 1, skipped: 0, failed: 0 });
  assert.equal(h.sent.length, 0);
  assert.equal(h.claimed.length, 0);
  assert.match(h.logs[0], /dry run: would send the return email to account/);
});

test("accounts that are not due, have nothing to show, are unconfirmed or are test addresses are skipped", async () => {
  const notDue = { id: B, profile: profile(), analyses: [done(10)] };
  const h1 = harness({ candidates: [notDue] });
  assert.equal((await runReturnEmails(h1.deps, opts)).skipped, 1);
  const h2 = harness({ candidates: [cand(A)], best: null });
  assert.equal((await runReturnEmails(h2.deps, opts)).skipped, 1);
  const h3 = harness({ candidates: [cand(A)], addresses: { [A]: { email: "x@gmail.com", confirmed: false } } });
  assert.equal((await runReturnEmails(h3.deps, opts)).skipped, 1);
  const h4 = harness({ candidates: [cand(A)], addresses: { [A]: { email: "t@example.com", confirmed: true } } });
  assert.equal((await runReturnEmails(h4.deps, opts)).skipped, 1);
  for (const h of [h1, h2, h3, h4]) assert.equal(h.sent.length, 0);
});

test("if another run already marked the account no second email goes out, and a failed send takes the mark back", async () => {
  const h = harness({ candidates: [cand(A)], claimFails: [A] });
  assert.equal((await runReturnEmails(h.deps, opts)).sent, 0);
  assert.equal(h.sent.length, 0);
  const f = harness({ candidates: [cand(A)], sendFails: true });
  const summary = await runReturnEmails(f.deps, opts);
  assert.equal(summary.failed, 1);
  assert.deepEqual(f.released, [A]);
});

test("the migration adds the sent mark and a private answers table, and does not mark existing accounts", () => {
  const sql = read("supabase/migrations/047_return_emails.sql");
  assert.match(sql, /add column if not exists return_email_at timestamptz/);
  assert.match(sql, /create table if not exists public\.return_feedback/);
  assert.match(sql, /reason text not null check \(reason in \('not_good', 'missed', 'cuts', 'slow', 'looking'\)\)/);
  assert.match(sql, /user_id uuid primary key references public\.profiles\(id\) on delete cascade/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on public\.return_feedback from public, anon, authenticated/);
  assert.doesNotMatch(sql, /update public\.profiles/);
});

test("the worker is off unless asked, runs on the processing service, and the answer link checks its signature", () => {
  const worker = read("lib/return-email-worker.ts");
  assert.match(worker, /mode !== "on" && mode !== "dry"\) return;/);
  assert.match(worker, /process\.env\.RETURN_EMAILS/);
  assert.match(worker, /ACTIVATION_EMAIL_SECRET is not set/);
  assert.match(worker, /RESEND_API_KEY is not set/);
  assert.match(worker, /eq\("status", "completed"\)/);
  const instr = read("instrumentation.ts");
  assert.ok(instr.indexOf("startReturnEmailWorker") > instr.indexOf('DEPLOYMENT_TARGET === "processing"'));
  const route = read("app/api/return-feedback/route.ts");
  assert.match(route, /verifyReason\(userId, reason, token, secret\)/);
  assert.match(route, /from\("return_feedback"\)/);
  assert.match(route, /onConflict: "user_id"/);
  assert.match(read(".env.example"), /RETURN_EMAILS=/);
});
