import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");

test("the password box has an eye that shows and hides what is typed, and takes every normal input prop", () => {
  const src = read("components/PasswordInput.tsx");
  assert.ok(src.includes('type={shown ? "text" : "password"}'));
  assert.ok(src.includes('aria-label={shown ? "Hide password" : "Show password"}'));
  assert.ok(src.includes('Omit<InputHTMLAttributes<HTMLInputElement>, "type">'));
  assert.ok(src.includes('type="button"'), "the eye never submits the form");
});

test("sign in, sign up and the new password page all use it, and no other page has a plain password field", () => {
  assert.equal((read("app/login/page.tsx").match(/<PasswordInput/g) ?? []).length, 1);
  assert.equal((read("app/reset-password/page.tsx").match(/<PasswordInput/g) ?? []).length, 2, "both the new password and the confirmation");
  const found = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx$/.test(name) && /type="password"/.test(readFileSync(full, "utf8"))) found.push(name);
    }
  };
  walk(path.join(root, "app")); walk(path.join(root, "components"));
  assert.deepEqual(found, [], "every password field goes through PasswordInput");
});

test("the browser's own built-in eye is hidden so there is only one", () => {
  assert.ok(read("app/globals.css").includes('input[type="password"]::-ms-reveal'));
});
