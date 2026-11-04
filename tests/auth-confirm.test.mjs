import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const code = ts.transpileModule(readFileSync(new URL("../app/auth/confirm/route.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
class NextResponse extends Response { static redirect(url) { return new NextResponse(null, { status: 307, headers: { location: String(url) } }); } }

function harness({ otpError = false } = {}) {
  const calls = [];
  const modules = {
    "next/server": { NextResponse },
    "next/headers": { cookies: async () => ({ getAll: () => [], set: () => {} }) },
    "@supabase/ssr": { createServerClient: () => ({ auth: { verifyOtp: async (args) => { calls.push(args); return { error: otpError ? new Error("expired") : null }; } } }) },
  };
  const exports = {};
  vm.runInNewContext(code, { exports, require: (n) => modules[n], process: { env: { NEXT_PUBLIC_SUPABASE_URL: "https://mock.local", NEXT_PUBLIC_SUPABASE_ANON_KEY: "x" } }, Response, URL, Set, Error, console });
  return { calls, get: (path) => exports.GET({ url: `https://www.klyp.world${path}` }) };
}

test("a good reset link signs them in and opens the new-password page, in any browser", async () => {
  const h = harness();
  const res = await h.get("/auth/confirm?token_hash=abc123&type=recovery");
  assert.equal(res.headers.get("location"), "https://www.klyp.world/reset-password");
  assert.equal(JSON.stringify(h.calls), JSON.stringify([{ token_hash: "abc123", type: "recovery" }]));
});

test("an expired or used reset link still lands on the new-password page, which offers a fresh link", async () => {
  const res = await harness({ otpError: true }).get("/auth/confirm?token_hash=old&type=recovery");
  assert.equal(res.headers.get("location"), "https://www.klyp.world/reset-password");
});

test("missing or unknown link types never reach Supabase and go to sign-in with an error", async () => {
  for (const path of ["/auth/confirm", "/auth/confirm?token_hash=abc", "/auth/confirm?token_hash=abc&type=admin", "/auth/confirm?type=recovery&token_hash="]) {
    const h = harness();
    const res = await h.get(path);
    assert.equal(h.calls.length, 0, path);
    assert.match(res.headers.get("location"), /\/(login\?error=auth_callback_failed|reset-password)$/);
  }
});

test("other email links (sign-up confirmation) go to the dashboard", async () => {
  const res = await harness().get("/auth/confirm?token_hash=abc&type=signup");
  assert.equal(res.headers.get("location"), "https://www.klyp.world/dashboard");
});
