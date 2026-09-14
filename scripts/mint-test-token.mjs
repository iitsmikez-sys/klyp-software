/**
 * Dev tool: mint a real Supabase access token for a test user without a
 * password prompt, via admin.generateLink + verifyOtp. Prints the bare
 * access_token to stdout so it can be captured in a shell variable.
 * Uses the service-role key from .env.local — never ship this to prod.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(root, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const email = process.argv[2] ?? "iitsmikez@gmail.com";

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
  type: "magiclink",
  email,
});
if (linkErr) throw linkErr;

const { data: sessionData, error: otpErr } = await anon.auth.verifyOtp({
  token_hash: linkData.properties.hashed_token,
  type: "magiclink",
});
if (otpErr) throw otpErr;

console.log(sessionData.session.access_token);
