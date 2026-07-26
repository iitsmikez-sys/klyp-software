/**
 * Dev tool: add (or subtract) Sparks on a user's profile.
 * Usage: node scripts/add-sparks.js <amount> [email]
 *   node scripts/add-sparks.js 500
 *   node scripts/add-sparks.js -500 someone@else.com
 * Uses the service-role key from .env.local — never ship this to prod.
 */
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const env = Object.fromEntries(
  fs
    .readFileSync(path.join(__dirname, "..", ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const amount = Number(process.argv[2]);
const email = process.argv[3] ?? "iitsmikez@gmail.com";
if (!Number.isInteger(amount) || amount === 0) {
  console.error("Usage: node scripts/add-sparks.js <amount> [email]");
  process.exit(1);
}

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  const { data, error } = await supabase.auth.admin.listUsers();
  if (error) throw error;
  const user = data.users.find((u) => u.email === email);
  if (!user) throw new Error(`No auth user with email ${email}`);

  const { data: prof, error: readErr } = await supabase
    .from("profiles")
    .select("sparks")
    .eq("id", user.id)
    .single();
  if (readErr) throw readErr;

  const next = prof.sparks + amount;
  const { error: writeErr } = await supabase.from("profiles").update({ sparks: next }).eq("id", user.id);
  if (writeErr) throw writeErr;

  console.log(`${email}: ${prof.sparks} -> ${next} sparks (${amount > 0 ? "+" : ""}${amount})`);
})().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
