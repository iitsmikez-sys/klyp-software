import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FEEDBACK_REASONS, isFeedbackReason, feedbackReasonLabel, shortBrowser, MAX_FEEDBACK_MESSAGE } from "../lib/feedback.ts";
import { buildFeedbackEmail } from "../lib/feedback-email.ts";
import { runFeedbackEmails } from "../lib/feedback-email-run.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");
const NOW = Date.parse("2026-11-08T12:00:00Z");
const row = (over = {}) => ({ id: "m1", user_id: "u1", reason: "clips", message: "It missed the funny part around 4:00.", page: "/dashboard", user_agent: "Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537", created_at: "2026-11-08T11:50:00Z", ...over });
const ctx = (over = {}) => ({ email: "person@gmail.com", plan: "free", sparks: 40, lastVideo: { platform: "twitch", status: "completed", error: null, at: "2026-11-08T09:00:00Z" }, ...over });

test("the four reasons, their labels and the limit", () => {
  assert.deepEqual(FEEDBACK_REASONS.map((r) => r.key), ["clips", "broke", "billing", "idea"]);
  assert.deepEqual(FEEDBACK_REASONS.map((r) => r.label), ["The clips weren't good", "Something broke", "Billing", "I have an idea"]);
  assert.equal(isFeedbackReason("broke"), true);
  assert.equal(isFeedbackReason("nope"), false);
  assert.equal(feedbackReasonLabel("idea"), "I have an idea");
  assert.equal(MAX_FEEDBACK_MESSAGE, 2000);
});

test("the browser is shown in plain words", () => {
  assert.equal(shortBrowser("Mozilla/5.0 (Windows NT 10.0; Win64) Chrome/120 Safari/537"), "Chrome on Windows");
  assert.equal(shortBrowser("Mozilla/5.0 (Windows NT 10.0) Chrome/120 Edg/120"), "Edge on Windows");
  assert.equal(shortBrowser("Mozilla/5.0 (iPhone; CPU iPhone OS 17) AppleWebKit Safari/604"), "Safari on iOS");
  assert.equal(shortBrowser(null), "unknown browser");
});

test("the email carries the message and everything needed to answer, and replying goes to the person", () => {
  const mail = buildFeedbackEmail(row(), ctx(), NOW);
  assert.equal(mail.subject, "[Klyp] The clips weren't good: It missed the funny part around 4:00.");
  assert.equal(mail.replyTo, "person@gmail.com");
  for (const part of [mail.text, mail.html]) {
    assert.ok(part.includes("It missed the funny part around 4:00."));
    assert.ok(part.includes("person@gmail.com") && part.includes("Free") && part.includes("40"));
    assert.ok(part.includes("/dashboard") && part.includes("Chrome on Windows"));
    assert.ok(part.includes("twitch, completed, 3 h ago"));
  }
  assert.match(mail.text, /Reply to this email to answer them directly\./);
});

test("a failed last video shows its error, an empty message is said plainly, and nothing breaks the page", () => {
  const failed = buildFeedbackEmail(row({ reason: "broke", message: "" }), ctx({ lastVideo: { platform: "youtube", status: "failed", error: "Sign in to confirm you're not a bot", at: "2026-11-08T11:00:00Z" } }), NOW);
  assert.match(failed.text, /youtube, failed, 1 h ago, error: Sign in to confirm you're not a bot/);
  assert.match(failed.text, /They picked a reason and left the box empty\./);
  assert.equal(failed.subject, "[Klyp] Something broke: (no message)");
  const evil = buildFeedbackEmail(row({ message: '<script>alert(1)</script> "x" & more' }), ctx(), NOW);
  assert.ok(!evil.html.includes("<script>") && evil.html.includes("&lt;script&gt;"));
  const unknown = buildFeedbackEmail(row(), ctx({ email: null, sparks: null, lastVideo: null }), NOW);
  assert.equal(unknown.replyTo, null);
  assert.match(unknown.text, /Last video: none yet/);
});

function harness({ rows, claimFails = [], sendFails = false, contextFails = false } = {}) {
  const sent = []; const claimed = []; const released = []; const logs = [];
  const deps = {
    now: () => NOW, log: (m) => logs.push(m),
    listUnsent: async () => rows,
    loadContext: async () => { if (contextFails) throw new Error("lookup failed"); return ctx(); },
    claim: async (id) => { if (claimFails.includes(id)) return false; claimed.push(id); return true; },
    release: async (id) => { released.push(id); },
    send: async (mail) => { if (sendFails) throw new Error("boom"); sent.push(mail); },
  };
  return { deps, sent, claimed, released, logs };
}

test("each message is emailed once to the owner, marked first, oldest first", async () => {
  const h = harness({ rows: [row({ id: "a" }), row({ id: "b" })] });
  const summary = await runFeedbackEmails(h.deps, { to: "owner@example.com" });
  assert.deepEqual(summary, { sent: 2, skipped: 0, failed: 0 });
  assert.deepEqual(h.claimed, ["a", "b"]);
  assert.ok(h.sent.every((m) => m.to === "owner@example.com" && m.replyTo === "person@gmail.com"));
});

test("a message another run already took is skipped, and a failed send takes the mark back so it is retried", async () => {
  const taken = harness({ rows: [row({ id: "a" })], claimFails: ["a"] });
  assert.deepEqual(await runFeedbackEmails(taken.deps, { to: "o@x.com" }), { sent: 0, skipped: 1, failed: 0 });
  const failing = harness({ rows: [row({ id: "a" })], sendFails: true });
  assert.deepEqual(await runFeedbackEmails(failing.deps, { to: "o@x.com" }), { sent: 0, skipped: 0, failed: 1 });
  assert.deepEqual(failing.released, ["a"]);
});

test("if the person's details cannot be looked up, the message still reaches the owner", async () => {
  const h = harness({ rows: [row({ id: "a" })], contextFails: true });
  const summary = await runFeedbackEmails(h.deps, { to: "o@x.com" });
  assert.equal(summary.sent, 1);
  assert.equal(h.sent[0].replyTo, null);
});

test("the migration: people add their own messages only, 10 an hour, and nobody reads them from the browser", () => {
  const sql = read("supabase/migrations/049_feedback_messages.sql");
  assert.match(sql, /create table if not exists public\.feedback_messages/);
  assert.match(sql, /reason in \('clips', 'broke', 'billing', 'idea'\)/);
  assert.match(sql, /char_length\(message\) <= 2000/);
  assert.match(sql, /emailed_at timestamptz/);
  assert.match(sql, /interval '1 hour'\) >= 10/);
  assert.match(sql, /for insert to authenticated with check \(auth\.uid\(\) = user_id\)/);
  assert.match(sql, /revoke all on public\.feedback_messages from public, anon, authenticated/);
  assert.match(sql, /grant insert on public\.feedback_messages to authenticated/);
  assert.doesNotMatch(sql, /grant (select|all)[^;]*to authenticated/i);
});

test("the worker emails only the owner, needs the key and an address, and can be switched off", () => {
  const w = read("lib/feedback-email-worker.ts");
  assert.match(w, /FEEDBACK_EMAILS \?\? ""\)\.trim\(\)\.toLowerCase\(\) === "off"/);
  assert.match(w, /process\.env\.FEEDBACK_TO \|\| process\.env\.ACTIVATION_REPLY_TO/);
  assert.match(w, /RESEND_API_KEY is not set/);
  assert.match(w, /reply_to: mail\.replyTo/);
  assert.match(w, /\.is\("emailed_at", null\)/);
  const instr = read("instrumentation.ts");
  assert.ok(instr.indexOf("startFeedbackEmailWorker") > instr.indexOf('DEPLOYMENT_TARGET === "processing"'));
  assert.match(read(".env.example"), /FEEDBACK_TO=/);
});

test("the button is a black circle that grows into a pill on hover, with the words on one line", () => {
  const css = read("components/FeedbackButton.module.css");
  assert.match(css, /\.fab \{[^}]*height: 48px;[^}]*max-width: 48px;[^}]*border-radius: 999px;[^}]*background: #0b0b0c;/);
  assert.match(css, /\.fab \{[^}]*flex-wrap: nowrap;/);
  assert.match(css, /\.label \{[^}]*white-space: nowrap;/);
  assert.match(css, /\.fab:hover, \.fab:focus-visible \{ max-width: 240px;/);
  assert.match(css, /\.fab:hover \.label, \.fab:focus-visible \.label \{ opacity: 1; \}/);
  // no stuck pill on touch screens, none while the form is open, and no motion for people who turn it off
  assert.match(css, /@media \(hover: none\) \{\s*\.fab:hover \{ max-width: 48px;/);
  assert.match(css, /\.fab\[aria-expanded="true"\], \.fab\[aria-expanded="true"\]:hover \{ max-width: 48px; \}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.fab, \.label \{ transition: none; \}/);
});

test("the form is white with black buttons, reasons are a radio list, and it works with a keyboard and a screen reader", () => {
  const css = read("components/FeedbackButton.module.css");
  assert.match(css, /\.panel \{[^}]*background: #fff;/);
  assert.match(css, /\.send \{[^}]*background: #111;/);
  const tsx = read("components/FeedbackButton.tsx");
  assert.match(tsx, /aria-label="Something wrong\? Send us a message"/);
  assert.match(tsx, /aria-expanded=\{open\}/);
  assert.match(tsx, /type="radio"/);
  assert.match(tsx, /event\.key === "Escape"/);
  assert.match(tsx, /maxLength=\{MAX_FEEDBACK_MESSAGE\}/);
  assert.match(tsx, /We'll include your last video and plan so you don't have to explain\./);
  assert.match(tsx, /Thanks, we got it/);
  assert.match(tsx, /We read every message and reply by email\./);
  assert.match(tsx, /from\("feedback_messages"\)\.insert\(/);
  assert.match(tsx, /disabled=\{!reason \|\| status === "sending"\}/);
});

test("it is on every dashboard page, and a failed download offers 'Tell us what happened'", () => {
  assert.match(read("app/(dashboard)/layout.tsx"), /<FeedbackButton \/>/);
  const panel = read("components/AnalyzePanel.tsx");
  assert.match(panel, /import \{ openFeedback \} from "\.\/FeedbackButton";/);
  assert.match(panel, /openFeedback\(\{ reason: "broke", message: `That download didn't work: \$\{downloadError\}` \}\)/);
  assert.match(panel, />Tell us what happened<\/button>/);
});
