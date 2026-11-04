import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { AFTER_AUTH_PATTERN, CLAIM_AFTER_RESET_COOKIE, CLAIM_NEXT_COOKIE, RESET_PATH, safeClaimNext } from "../lib/claim-next.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");

test("after a sign-in link the callback only goes to /claim or the new-password page", () => {
  for (const ok of ["/reset-password", "/claim", "/claim?offer=17&until=2026-11-09&src=email2"]) assert.ok(AFTER_AUTH_PATTERN.test(ok), ok);
  for (const bad of ["/dashboard", "/reset-password/x", "/reset-password?x=1", "//evil.com", "https://evil.com", "/claimx", "/"]) assert.ok(!AFTER_AUTH_PATTERN.test(bad), bad);
  assert.equal(RESET_PATH, "/reset-password");
  // The login page's own return path stays /claim only.
  assert.equal(safeClaimNext("/reset-password"), null);
});

test("the login page offers Forgot password and says what to try when the password is wrong", () => {
  const login = read("app/login/page.tsx");
  assert.match(login, /Forgot password\?/);
  assert.match(login, /href=\{`\/forgot-password/);
  assert.match(login, /Wrong email or password\. Signed up with Google or Discord\?/);
  assert.match(login, /setError\(friendlyLoginError\(error\.message\)\)/);
  // Other errors (sign-up, Google) keep their original text.
  assert.ok(login.includes("setError(error.message)"));
});

test("the forgot-password page sends the reset email, returns through the sign-in callback, and never says whether the account exists", () => {
  const page = read("app/forgot-password/page.tsx");
  assert.match(page, /resetPasswordForEmail\(email\.trim\(\)/);
  assert.match(page, /redirectTo: `\$\{window\.location\.origin\}\/auth\/callback`/);
  assert.ok(page.includes("CLAIM_NEXT_COOKIE") && page.includes("RESET_PATH"));
  assert.ok(page.includes("CLAIM_AFTER_RESET_COOKIE") && page.includes("safeClaimNext("));
  assert.deepEqual([CLAIM_NEXT_COOKIE, CLAIM_AFTER_RESET_COOKIE], ["klyp_next", "klyp_claim"]);
  assert.match(page, /If there's an account for that email/);
});

test("the reset page needs a signed-in link, checks the two passwords, and goes back to /claim or the dashboard", () => {
  const page = read("app/reset-password/page.tsx");
  assert.match(page, /auth\.getUser\(\)/);
  assert.match(page, /expired or was already used/);
  assert.match(page, /password\.length < 8/);
  assert.match(page, /password !== confirm/);
  assert.match(page, /updateUser\(\{ password \}\)/);
  assert.match(page, /router\.push\(claim \?\? "\/dashboard"\)/);
  assert.match(page, /safeClaimNext\(readCookie\(CLAIM_AFTER_RESET_COOKIE\)\)/);
});
