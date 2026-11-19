import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildClipsReadyEmail, sendClipsReady, reviewUrl, TOP_SHOWN } from "../lib/clips-ready-email.ts";
import { reviewSince } from "../lib/review-since.ts";
import { verifyUnsubscribe } from "../lib/activation-unsubscribe.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");
const USER = "11111111-2222-3333-4444-555555555555";
const clips = [{ title: "Chat made him rage quit", score: 71 }, { title: "He hit the 1HP clutch", score: 88 }, { title: "Why he cancels plans", score: 76 }, { title: "Fourth one", score: 66 }];

test("the email counts the clips, lists the top three best first, and links to the review page", () => {
  const mail = buildClipsReadyEmail({ clips, reviewUrl: "https://example.com/r", unsubscribeUrl: "https://example.com/u" });
  assert.equal(mail.subject, "Your stream ended: 4 clips are ready");
  assert.equal(TOP_SHOWN, 3);
  const order = ["He hit the 1HP clutch", "Why he cancels plans", "Chat made him rage quit"].map((t) => mail.text.indexOf(t));
  assert.ok(order.every((i) => i >= 0) && order[0] < order[1] && order[1] < order[2], "best first");
  assert.ok(!mail.text.includes("Fourth one"), "only the top three are listed");
  assert.ok(mail.html.includes('href="https://example.com/r"') && mail.html.includes('href="https://example.com/u"'));
  assert.ok(mail.text.includes("Review my clips: https://example.com/r") && mail.text.includes("Unsubscribe: https://example.com/u"));
});

test("one clip reads correctly, and titles are cleaned and escaped", () => {
  const mail = buildClipsReadyEmail({ clips: [{ title: "<b>Boo</b>\n& co", score: 80 }], reviewUrl: "https://e/r", unsubscribeUrl: "https://e/u" });
  assert.equal(mail.subject, "Your stream ended: 1 clip is ready");
  assert.ok(!mail.html.includes("<b>Boo"), "markup in a title is escaped");
  assert.ok(mail.html.includes("&lt;b&gt;Boo&lt;/b&gt; &amp; co"));
});

test("the review link carries the time the clips were made", () => {
  assert.equal(reviewUrl("https://www.klyp.world/", "2026-11-19T10:00:00.000Z"), "https://www.klyp.world/dashboard/review?since=2026-11-19T10%3A00%3A00.000Z");
});

const deps = (over = {}) => {
  const sent = [];
  return { sent, logs: [], getRecipient: async () => ({ email: "a@b.co", emailsOff: false }), send: async (m) => { sent.push(m); }, log() {}, ...over };
};
const args = (over = {}) => ({ userId: USER, clips, sinceIso: "2026-11-19T10:00:00.000Z", siteUrl: "https://www.klyp.world", secret: "s3cret", mode: undefined, ...over });

test("it sends one email with a signed unsubscribe link", async () => {
  const d = deps();
  assert.equal(await sendClipsReady(d, args()), "sent");
  assert.equal(d.sent.length, 1);
  assert.equal(d.sent[0].to, "a@b.co");
  const url = new URL(d.sent[0].unsubscribeUrl);
  assert.equal(verifyUnsubscribe(url.searchParams.get("u"), url.searchParams.get("t"), "s3cret"), true);
});

test("it stays quiet when off, with no secret, no clips, no address, or emails switched off", async () => {
  for (const [over, d] of [
    [{ mode: "off" }, deps()], [{ secret: undefined }, deps()], [{ clips: [] }, deps()],
    [{}, deps({ getRecipient: async () => null })],
    [{}, deps({ getRecipient: async () => ({ email: null, emailsOff: false }) })],
    [{}, deps({ getRecipient: async () => ({ email: "a@b.co", emailsOff: true }) })],
  ]) {
    assert.equal(await sendClipsReady(d, args(over)), "skipped");
    assert.equal(d.sent.length, 0);
  }
});

test("a failing email never throws into the clipping job", async () => {
  const d = deps({ send: async () => { throw new Error("service down"); } });
  assert.equal(await sendClipsReady(d, args()), "skipped");
});

test("the review page opens on the clips in the link, and falls back to 3 days for a bad or future time", () => {
  const now = Date.parse("2026-11-19T12:00:00Z");
  assert.equal(reviewSince("2026-11-19T10:00:00.000Z", now), "2026-11-19T10:00:00.000Z");
  assert.equal(reviewSince("2026-11-10T00:00:00.000Z", now), "2026-11-10T00:00:00.000Z");
  const fallback = new Date(now - 3 * 86_400_000).toISOString();
  assert.equal(reviewSince(null, now), fallback);
  assert.equal(reviewSince("nonsense", now), fallback);
  assert.equal(reviewSince("2027-01-01T00:00:00Z", now), fallback);
});

test("automatic clipping sends the email after saving, and the review page keeps, deletes and skips rated clips", () => {
  const poll = read("lib/vod-poll.ts");
  assert.ok(poll.includes("await sendClipsReady(clipsReadyDeps(admin)"));
  assert.ok(poll.indexOf("finish_auto_vod_job\", {\n      p_job_id: job.id, p_clips: rows") < poll.indexOf("await sendClipsReady("), "the email comes after the clips are saved");
  const page = read("app/(dashboard)/dashboard/review/page.tsx");
  assert.ok(page.includes('decide("approved")') && page.includes('decide("rejected")'));
  assert.ok(page.includes('rpc("record_clip_feedback"') && page.includes('.from("clips").delete()'));
  assert.ok(page.includes("!rated.has(c.id)"), "already rated clips are not shown again");
});
