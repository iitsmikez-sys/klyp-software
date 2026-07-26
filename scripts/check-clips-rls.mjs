/** Dev tool: read-only RLS probe — does an unauthenticated (anon-key) client see clip rows? */
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

// No session — same view a fresh unauthenticated visitor's browser would get.
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const { data, error } = await anon.from("clips").select("id,user_id").limit(5);
console.log("anon (unauthenticated) select on clips:");
console.log("  error:", error?.message ?? "(none)");
console.log("  rows returned:", data?.length ?? 0, data ?? "");
