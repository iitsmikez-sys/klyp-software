/** Dev tool: read-only inspection of the live `clips` table schema/row count. */
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

const { data, error } = await admin.from("clips").select("*").limit(1);
if (error) { console.log("SELECT error:", error.message); process.exit(0); }
console.log("clips columns:", data.length ? Object.keys(data[0]) : "(table empty — no columns to sample)");

const { count, error: countErr } = await admin.from("clips").select("*", { count: "exact", head: true });
console.log("total clip rows:", count, countErr?.message ?? "");

const { error: hwErr } = await admin.from("clips").select("hooks, words").limit(1);
console.log("hooks/words columns present:", hwErr ? `NO — ${hwErr.message}` : "yes");
