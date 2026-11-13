import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BLOCKED_EMAIL_DOMAINS, emailDomain, isBlockedEmailDomain, isGuardRefusal } from "../lib/signup-guards.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");

test("throwaway email services are recognised, real providers and look-alikes are not", () => {
  for (const email of ["a@mailinator.com", "x@YopMail.com", "me@emailkeep.com", "me@playfine.com", " b@guerrillamail.net "]) assert.ok(isBlockedEmailDomain(email), email);
  for (const email of ["me@gmail.com", "me@outlook.com", "me@icloud.com", "me@passinbox.com", "me@klyp.world", "me@notmailinator.com", "me@mailinator.com.au", "nonsense"]) assert.ok(!isBlockedEmailDomain(email), email);
  assert.equal(emailDomain("Some.One@Example.COM "), "example.com");
  assert.equal(emailDomain("nonsense"), "");
});

test("privacy and alias providers real people use are not on the list", () => {
  for (const domain of ["passinbox.com", "gmail.com", "icloud.com", "outlook.com", "proton.me", "protonmail.com", "33mail.com", "simplelogin.com", "duck.com"]) {
    assert.ok(!(BLOCKED_EMAIL_DOMAINS).includes(domain), domain);
  }
});

test("the database refuses what the page refuses: the two lists are the same", () => {
  const sql = read("supabase/migrations/052_signup_guards.sql");
  const inSql = [...sql.matchAll(/^\s+\('([^']+)'\)/gm)].map((m) => m[1]).sort();
  assert.deepEqual(inSql, [...BLOCKED_EMAIL_DOMAINS].sort());
});

test("the migration guards every new account before it is created, ignores Gmail dots and +tags, and always allows klyp.world", () => {
  const sql = read("supabase/migrations/052_signup_guards.sql");
  assert.match(sql, /create trigger guard_new_user\s+before insert on auth\.users/);
  assert.ok(sql.includes("raise exception 'blocked_email_domain';"));
  assert.ok(sql.includes("raise exception 'duplicate_email';"));
  assert.ok(sql.includes("u.id <> new.id"), "never compares an account with itself");
  assert.ok(sql.includes("if dom = 'klyp.world' then"));
  assert.ok(sql.includes("if new.email is null or new.email = '' then"), "sign-ins without an email are not broken");
  assert.ok(sql.includes("drop trigger if exists guard_new_user on auth.users;"), "the way to switch it off is written down");
  assert.ok(sql.includes("alter table public.blocked_email_domains enable row level security;"));
});

test("the database normalises email the way the guard promises (Gmail dots, +tags, googlemail)", () => {
  const sql = read("supabase/migrations/052_signup_guards.sql");
  assert.ok(sql.includes("if dom = 'googlemail.com' then"));
  assert.ok(sql.includes("loc := left(loc, plus_pos - 1);"));
  assert.ok(sql.includes("loc := replace(loc, '.', '');"));
});

test("the login page stops throwaway emails before sending anything, and words the database's refusal plainly", () => {
  const page = read("app/login/page.tsx");
  assert.ok(page.includes("if (isBlockedEmailDomain(email)) {"));
  assert.ok(page.indexOf("isBlockedEmailDomain(email)") < page.indexOf("supabase.auth.signUp("));
  assert.ok(page.includes("isGuardRefusal(error.message) ? DUPLICATE_SIGNUP_MESSAGE : error.message"));
  assert.equal(isGuardRefusal("Database error saving new user"), true);
  assert.equal(isGuardRefusal("duplicate_email"), true);
  assert.equal(isGuardRefusal("Invalid login credentials"), false);
  assert.equal(isGuardRefusal(null), false);
});

test("the weekly report only reads: it never changes an account", () => {
  const script = read("scripts/suspect-accounts.mjs");
  assert.doesNotMatch(script, /\.(update|insert|delete|upsert|rpc)\(/);
  assert.doesNotMatch(script, /admin\.(deleteUser|updateUserById|createUser)/);
  assert.ok(script.includes("Nothing was changed."));
});
