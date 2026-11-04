import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as offer from "../lib/offer-cookie.ts";
import { AFTER_AUTH_PATTERN, safeClaimNext } from "../lib/claim-next.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");
const transpile = (p) => ts.transpileModule(read(p), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const claimCode = transpile("app/claim/route.ts");

class NextResponse extends Response {
  constructor(body, init) { super(body, init); this.setCookies = []; this.cookies = { set: (name, value, opts) => this.setCookies.push({ name, value, opts }) }; }
  static redirect(url, status = 307) { return new NextResponse(null, { status, headers: { location: String(url) } }); }
}
class NextRequest {
  constructor(url, init = {}) {
    this.url = String(url); this.nextUrl = new URL(this.url); this.method = init.method ?? "GET"; this.headers = new Headers(init.headers ?? {}); this._body = init.body;
    const jar = new Map(); for (const part of (this.headers.get("cookie") ?? "").split(/;\s*/).filter(Boolean)) { const i = part.indexOf("="); jar.set(part.slice(0, i), part.slice(i + 1)); }
    this.cookies = { get: (n) => (jar.has(n) ? { value: jar.get(n) } : undefined) };
  }
  async json() { return JSON.parse(this._body ?? "{}"); }
}

function harness({ signedIn = true, checkout = { ok: true, body: { url: "https://checkout.stripe.com/s1", first_month: true } }, cookie = "" } = {}) {
  const posted = [];
  const modules = {
    "next/server": { NextRequest, NextResponse },
    "@/lib/supabase/server": { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: signedIn ? { id: "u1" } : null } }) } }) },
    "@/lib/offer-cookie": offer,
    "@/app/api/stripe/checkout/route": { POST: async (req) => { posted.push({ cookie: req.headers.get("cookie"), body: await req.json() }); return new Response(JSON.stringify(checkout.body), { status: checkout.ok ? 200 : 400 }); } },
  };
  const exports = {};
  vm.runInNewContext(claimCode, { exports, require: (n) => modules[n], process: { env: {} }, Response, Headers, URL, Date, Error, JSON, encodeURIComponent, console });
  return { posted, get: (path) => exports.GET(new NextRequest(`https://www.klyp.world${path}`, { headers: cookie ? { cookie } : {} })) };
}
const live = () => `/claim?offer=17&until=${new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10)}&src=email2`;

test("signed in with a live link: straight to Stripe, the $17 offer is passed on, and it is a one-month plan", async () => {
  const h = harness();
  const res = await h.get(live());
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "https://checkout.stripe.com/s1");
  assert.deepEqual(h.posted[0].body, { interval: "month" });
  assert.match(h.posted[0].cookie, /^klyp_offer=17\|\d+$/);
  assert.equal(res.setCookies[0].name, "klyp_offer");
});

test("signed out: sign in first, with a return path that is only /claim", async () => {
  const h = harness({ signedIn: false });
  const res = await h.get(live());
  const location = new URL(res.headers.get("location"));
  assert.equal(location.pathname, "/login");
  const next = location.searchParams.get("next");
  assert.ok(safeClaimNext(next), next);
  assert.ok(next.startsWith("/claim?offer=17&until="));
  assert.equal(h.posted.length, 0);
});

test("an ended offer goes to the normal upgrade page and never reaches Stripe", async () => {
  const h = harness();
  const res = await h.get("/claim?offer=17&until=2026-11-01");
  assert.equal(res.headers.get("location"), "https://www.klyp.world/dashboard/upgrade");
  assert.equal(h.posted.length, 0);
  assert.equal(res.setCookies.length, 0);
  for (const bad of ["/claim", "/claim?offer=17&until=garbage"]) assert.equal((await h.get(bad)).headers.get("location"), "https://www.klyp.world/dashboard/upgrade", bad);
});

test("a link without an end date still works (like the ad link)", async () => {
  const h = harness();
  const res = await h.get("/claim?offer=17");
  assert.equal(res.headers.get("location"), "https://checkout.stripe.com/s1");
});

test("someone who cannot get $17 (already Pro, paid before, or any error) is sent to the upgrade page, not a mismatched Stripe page", async () => {
  for (const checkout of [
    { ok: true, body: { url: "https://checkout.stripe.com/s2", first_month: false } },
    { ok: false, body: { error: "You're already subscribed. Open Manage billing instead." } },
    { ok: true, body: {} },
  ]) {
    const res = await harness({ checkout }).get(live());
    assert.equal(res.headers.get("location"), "https://www.klyp.world/dashboard/upgrade");
  }
});

test("only /claim return paths are accepted after sign-in", () => {
  for (const ok of ["/claim", "/claim?offer=17&until=2026-11-09&src=email2"]) assert.equal(safeClaimNext(ok), ok);
  for (const bad of [null, undefined, "", "/dashboard", "//evil.com", "https://evil.com", "/claim/../x", "/claimx", "/claim?x=<script>", "/claim?" + "a".repeat(300), "/claim\n"]) assert.equal(safeClaimNext(bad), null, String(bad));
});

test("the sign-in callback uses the same rule and goes back to /claim, wiring is in place", () => {
  const callback = read("app/auth/callback/route.ts");
  assert.ok(callback.includes(AFTER_AUTH_PATTERN.source), "callback has the same pattern as lib/claim-next.ts");
  assert.match(callback, /cookieStore\.get\?\.\("klyp_next"\)/);
  const login = read("app/login/page.tsx");
  assert.match(login, /rememberClaimNext\(\);/);
  assert.equal((login.match(/router\.push\(nextAfterLogin\(\)\)/g) ?? []).length, 2);
  assert.ok(!login.includes('router.push("/dashboard")'));
});
