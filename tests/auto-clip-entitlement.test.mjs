import assert from "node:assert/strict";
import test from "node:test";
import { hasAutoClipAccess, revokeAutoClip, ensureAutoClipEntitled } from "../lib/auto-clip-entitlement.ts";
import { fakeAdmin, notifier } from "./helpers/fake-admin.mjs";

const PRO = { id: "u-pro", tier: "pro", stripe_subscription_id: "sub_1" };
const FREE = { id: "u-free", tier: "free", stripe_subscription_id: null };
const COMP = { id: "u-comp", tier: "pro", stripe_subscription_id: null };
const DRIFT = { id: "u-drift", tier: "pro", stripe_subscription_id: null };
const profilesOf = (...ps) => Object.fromEntries(ps.map((p) => [p.id, p]));

test("access: a paying Pro subscriber has it, with no extra account lookup", async () => {
  const admin = fakeAdmin({ profiles: profilesOf(PRO) });
  assert.equal(await hasAutoClipAccess(admin, "u-pro"), true);
  assert.equal(admin.state.authLookups, 0);
});
test("access: Free does not, and complimentary Pro does", async () => {
  const admin = fakeAdmin({ profiles: profilesOf(FREE, COMP, DRIFT), comp: { "u-comp": true } });
  assert.equal(await hasAutoClipAccess(admin, "u-free"), false);
  assert.equal(await hasAutoClipAccess(admin, "u-comp"), true);
  assert.equal(await hasAutoClipAccess(admin, "u-drift"), false); // "pro" flag, no subscription, not complimentary
});
test("access: an unknown user has none", async () => {
  assert.equal(await hasAutoClipAccess(fakeAdmin({ profiles: {} }), "ghost"), false);
});
test("access: if the plan cannot be read, it throws rather than guessing", async () => {
  await assert.rejects(hasAutoClipAccess(fakeAdmin({ profiles: profilesOf(FREE), failOn: "profile" }), "u-free"), /Could not load the plan/);
  await assert.rejects(hasAutoClipAccess(fakeAdmin({ profiles: profilesOf(DRIFT), failOn: "auth" }), "u-drift"), /Could not load the account/);
});

const ch = (extra = {}) => ({ id: "s1", user_id: "u-free", twitch_login: "karmic", auto_clip_enabled: true, ...extra });

test("a Free user's channel with auto-clipping on is switched off, queued work is cleared, and they are told ONCE", async () => {
  const streams = [ch(), ch({ id: "s2", user_id: "someone-else" })];
  const jobs = [{ stream_id: "s1", status: "pending" }, { stream_id: "s1", status: "retry" }, { stream_id: "s1", status: "processing", lease_until: "x" },
    { stream_id: "s1", status: "done" }, { stream_id: "s2", status: "pending" }];
  const checks = [{ stream_id: "s1" }, { stream_id: "s2" }];
  const admin = fakeAdmin({ profiles: profilesOf(FREE), streams, jobs, checks });
  const n = notifier();
  assert.equal(await ensureAutoClipEntitled(admin, streams[0], n.notify), false);
  assert.equal(streams[0].auto_clip_enabled, false);
  assert.deepEqual(jobs.map((j) => j.status), ["canceled", "canceled", "canceled", "done", "pending"]);
  assert.equal(jobs[2].lease_until, null);
  assert.deepEqual(checks, [{ stream_id: "s2" }], "only this channel's pending checks are removed");
  assert.equal(streams[1].auto_clip_enabled, true, "other channels are untouched");
  assert.equal(n.sent.length, 1);
  assert.equal(n.sent[0].userId, "u-free");
  assert.match(n.sent[0].message, /Pro feature.*turned off for karmic.*Upgrade to Pro/);
});

test("it is idempotent: the sweep, the worker and the event route meeting the same channel notify only once", async () => {
  const streams = [ch()];
  const admin = fakeAdmin({ profiles: profilesOf(FREE), streams });
  const n = notifier();
  for (let i = 0; i < 4; i++) await ensureAutoClipEntitled(admin, streams[0], n.notify);
  assert.equal(n.sent.length, 1);
});

test("Pro and complimentary Pro channels are left exactly as they are", async () => {
  for (const [profile, comp] of [[PRO, {}], [COMP, { "u-comp": true }]]) {
    const streams = [ch({ user_id: profile.id })];
    const jobs = [{ stream_id: "s1", status: "pending" }];
    const admin = fakeAdmin({ profiles: profilesOf(profile), comp, streams, jobs, checks: [{ stream_id: "s1" }] });
    const n = notifier();
    assert.equal(await ensureAutoClipEntitled(admin, streams[0], n.notify), true);
    assert.equal(streams[0].auto_clip_enabled, true);
    assert.equal(jobs[0].status, "pending");
    assert.equal(n.sent.length, 0);
  }
});

test("a Pro user whose subscription ended loses it the same way", async () => {
  const lapsed = { id: "u-lapsed", tier: "free", stripe_subscription_id: null }; // the webhook downgrades the profile on cancellation
  const streams = [ch({ user_id: "u-lapsed" })];
  const admin = fakeAdmin({ profiles: profilesOf(lapsed), streams });
  const n = notifier();
  assert.equal(await ensureAutoClipEntitled(admin, streams[0], n.notify), false);
  assert.equal(streams[0].auto_clip_enabled, false);
});

test("if the plan cannot be determined, nothing is switched off", async () => {
  const streams = [ch()];
  const admin = fakeAdmin({ profiles: profilesOf(FREE), streams, failOn: "profile" });
  const n = notifier();
  await assert.rejects(ensureAutoClipEntitled(admin, streams[0], n.notify));
  assert.equal(streams[0].auto_clip_enabled, true);
  assert.equal(n.sent.length, 0);
});

test("if clearing queued work fails the error surfaces, so the next pass retries it", async () => {
  const streams = [ch()];
  const admin = fakeAdmin({ profiles: profilesOf(FREE), streams, jobs: [{ stream_id: "s1", status: "pending" }], failOn: "jobs" });
  await assert.rejects(revokeAutoClip(admin, streams[0], notifier().notify), /Could not clear queued auto-clip work/);
});
