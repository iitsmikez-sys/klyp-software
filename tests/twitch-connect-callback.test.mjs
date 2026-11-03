import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../app/api/twitch/callback/route.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;

const USER = "user-1";
/**
 * The callback with the database faked the way production behaves: a signed-in user's own client may
 * read and insert channel rows but an UPDATE through it matches nothing (there is no UPDATE policy) and
 * returns no error. Only the server's admin client can change a row.
 */
function harness({ row, adminUpdateMatches = true } = {}) {
  const rows = row ? [{ ...row }] : [];
  const table = (mode) => () => {
    const f = { eq: [], isNull: [], op: "select", changes: null };
    const match = (r) => f.eq.every(([c, v]) => r[c] === v) && f.isNull.every((c) => r[c] == null);
    const q = {
      select() { return q; },
      eq(c, v) { f.eq.push([c, v]); return q; },
      is(c) { f.isNull.push(c); return q; },
      update(changes) { f.op = "update"; f.changes = changes; return q; },
      insert(r) { f.op = "insert"; f.rec = { id: `new-${rows.length + 1}`, ...r }; return q; },
      maybeSingle() { return Promise.resolve({ data: rows.find(match) ?? null, error: null }); },
      single() { rows.push(f.rec); return Promise.resolve({ data: { id: f.rec.id }, error: null }); },
      then(resolve, reject) {
        return Promise.resolve().then(() => {
          if (f.op === "update") {
            // user session: RLS hides the row from UPDATE; admin: matches only if the test allows it
            const hit = mode === "admin" && adminUpdateMatches ? rows.filter(match) : [];
            hit.forEach((r) => Object.assign(r, f.changes));
            return { data: hit.map((r) => ({ id: r.id })), error: null };
          }
          return { data: rows.filter(match), error: null };
        }).then(resolve, reject);
      },
    };
    return q;
  };
  const saved = [];
  class NextResponse {
    static redirect(url) { const r = new NextResponse(); r.location = String(url); r.cookies = { delete() {} }; return r; }
  }
  const modules = {
    "next/server": { NextResponse },
    "@/lib/supabase/server": { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: USER } } }) }, from: table("user") }) },
    "@/lib/supabase/admin": { createAdminClient: () => ({ from: table("admin") }) },
    "@/lib/twitch": {
      exchangeTwitchCode: async () => "token",
      getTwitchUser: async () => ({ id: "tw-123", login: "karmicmr" }),
      ensureStreamOfflineSubscription: async () => "sub-new",
    },
    "@/lib/twitch-subscription": { saveEventSubSubscription: async (_c, id, _u, sub) => saved.push([id, sub]) },
  };
  const exports = {};
  vm.runInNewContext(code, { exports, require: (n) => modules[n], process: { env: { NEXT_PUBLIC_PROCESSING_API_URL: "https://worker.example" } }, console, URL, Error });
  const run = async () => {
    const req = { url: "https://www.klyp.world/api/twitch/callback?code=c&state=s", cookies: { get: () => ({ value: "s" }) } };
    return new URL((await exports.GET(req)).location).searchParams.get("twitch");
  };
  return { run, rows, saved };
}

const urlOnly = { id: "row-1", user_id: USER, channel_url: "https://www.twitch.tv/karmicmr", twitch_user_id: null, twitch_login: null, eventsub_subscription_id: "old-sub" };

test("a channel added by URL becomes Connected: the Twitch identity is really saved on the existing row", async () => {
  const h = harness({ row: urlOnly });
  assert.equal(await h.run(), "connected");
  assert.equal(h.rows.length, 1); // adopted, not duplicated
  assert.equal(h.rows[0].twitch_user_id, "tw-123");
  assert.equal(h.rows[0].twitch_login, "karmicmr");
});

test("if the save changes nothing, the person is told it failed instead of 'connected'", async () => {
  const h = harness({ row: urlOnly, adminUpdateMatches: false });
  assert.equal(await h.run(), "save_failed");
  assert.equal(h.rows[0].twitch_user_id, null);
});

test("a first-time connection with no existing row inserts one and subscribes to stream-ended", async () => {
  const h = harness({});
  assert.equal(await h.run(), "connected");
  assert.equal(h.rows.length, 1);
  assert.equal(h.rows[0].twitch_user_id, "tw-123");
  assert.equal(h.saved.length, 1);
});

test("the row is only changed for the signed-in user's own channel", async () => {
  const h = harness({ row: { ...urlOnly, user_id: "someone-else" } });
  const result = await h.run();
  assert.notEqual(h.rows[0].twitch_user_id, "tw-123"); // someone else's row untouched
  assert.ok(["connected", "save_failed", "already_connected"].includes(result));
});
