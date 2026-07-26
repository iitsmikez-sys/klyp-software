/** Dev tool: read-only check — any profile marked tier='pro' with no real Stripe subscription behind it? */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const env = Object.fromEntries(
  fs.readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const { data, error } = await admin
  .from("profiles")
  .select("id, tier, sparks, stripe_customer_id, stripe_subscription_id, created_at")
  .eq("tier", "pro");
if (error) { console.log("error:", error.message); process.exit(0); }
console.log(`profiles with tier='pro': ${data.length}`);
for (const p of data) {
  console.log(`  ${p.id}  customer=${p.stripe_customer_id ?? "NONE"}  subscription=${p.stripe_subscription_id ?? "NONE"}  sparks=${p.sparks}`);
}
