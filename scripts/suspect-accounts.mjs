/**
 * Weekly check for free-plan multi-accounting. READ-ONLY: it prints who looks like a duplicate and changes nothing.
 *   node scripts/suspect-accounts.mjs            (needs .env.local with the Supabase URL and service role key)
 *   node scripts/suspect-accounts.mjs --days 7   (only accounts created in the last 7 days; default 7)
 *
 * It lists: (1) the same real email twice (Gmail dots and +tags), (2) similar names across providers, like ani@gmail.com and
 * ani1@outlook.com, (3) throwaway domains still in use, and nothing else (a busy signup hour is normal and is not flagged).
 * "Similar" is a hint, not proof: look before acting. Nothing here bans or changes an account.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(path.join(root, "package.json"));
const { createClient } = require("@supabase/supabase-js");
const env = Object.fromEntries(readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l))
  .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const daysArg = process.argv.indexOf("--days");
const days = daysArg > -1 ? Number(process.argv[daysArg + 1]) || 7 : 7;
const since = Date.now() - days * 86_400_000;

// Keep this in step with normalizeEmail (lib/pro-trial.ts) and normalize_email (supabase/migrations/052_signup_guards.sql).
function normalize(email) {
  const t = (email ?? "").trim().toLowerCase();
  const at = t.lastIndexOf("@");
  if (at < 1) return t;
  let local = t.slice(0, at), domain = t.slice(at + 1);
  if (domain === "googlemail.com") domain = "gmail.com";
  const plus = local.indexOf("+");
  if (plus > 0) local = local.slice(0, plus);
  if (domain === "gmail.com") local = local.split(".").join("");
  return `${local}@${domain}`;
}
const stem = (email) => normalize(email).split("@")[0].replace(/[0-9_.\-]+$/g, "");
const guards = readFileSync(path.join(root, "lib/signup-guards.ts"), "utf8");
const blocked = [...(/BLOCKED_EMAIL_DOMAINS = \[([\s\S]*?)\] as const;/.exec(guards)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);

const { data: au, error } = await db.auth.admin.listUsers({ perPage: 1000 });
if (error) throw error;
const users = au.users.filter((u) => u.email && !/@klyp\.world$/i.test(u.email));
const { data: jobs } = await db.from("analysis_jobs").select("user_id").eq("status", "completed").limit(20000);
const ran = new Set((jobs ?? []).map((j) => j.user_id));
const recent = (u) => Date.parse(u.created_at) >= since;
const label = (u) => `${u.email}  (joined ${u.created_at.slice(0, 10)}${ran.has(u.id) ? ", ran a video" : ""})`;

const group = (keyFn) => {
  const map = {};
  for (const u of users) { const k = keyFn(u); if (k && k.length >= 4) (map[k] ??= []).push(u); }
  return Object.values(map).filter((g) => g.length > 1 && g.some(recent));
};

console.log(`Suspect accounts, last ${days} days (${users.length} accounts checked)\n`);

const same = group((u) => normalize(u.email));
console.log(`1. Same real email twice: ${same.length}`);
for (const g of same) console.log("   - " + g.map(label).join("\n     "));

const similar = group((u) => stem(u.email)).filter((g) => new Set(g.map((u) => normalize(u.email))).size > 1);
console.log(`\n2. Similar names on different addresses: ${similar.length}  (a hint, not proof)`);
for (const g of similar) console.log("   - " + g.map(label).join("\n     "));

const throwaway = users.filter((u) => blocked.includes(u.email.split("@")[1].toLowerCase()) && recent(u));
console.log(`\n3. Throwaway email domains: ${throwaway.length}`);
for (const u of throwaway) console.log("   - " + label(u));

console.log("\nNothing was changed. Decide case by case.");
