/**
 * Bearer-token variant of lib/profile.ts — used by the processing service
 * (analyze/clip/preview/upload), which runs on a different origin than the
 * Vercel frontend and can't rely on Supabase's cookie-based session (cookies
 * never cross origins). The frontend sends the user's Supabase access token
 * as `Authorization: Bearer <token>` (see lib/processing-api.ts); this
 * validates it and scopes a plain anon-key client to it, so the same RPCs
 * (get_profile, consume_sparks) run under the same auth.uid() as the
 * cookie-based path — no RLS or database changes needed.
 */
import { createClient } from "@supabase/supabase-js";
import type { Profile } from "@/lib/tier";

function tokenClient(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

/** Extract the bearer token from a request's Authorization header, or null. */
export function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}

/**
 * Validate the token against Supabase Auth, then load the profile.
 * getUser(token) — explicit-argument form — is Supabase's documented way to
 * verify an arbitrary JWT server-side; it always round-trips to the Auth
 * server rather than trusting the token's claims blindly.
 */
export async function getProfileFromToken(token: string): Promise<Profile | null> {
  const supabase = tokenClient(token);
  const { data: { user }, error: userError } = await supabase.auth.getUser(token);
  if (userError || !user) return null;
  const { data, error } = await supabase.rpc("get_profile");
  if (error) throw new Error(`Failed to load profile: ${error.message}`);
  return data as Profile;
}

export async function consumeSparksFromToken(token: string, amount: number): Promise<number> {
  const supabase = tokenClient(token);
  const { data, error } = await supabase.rpc("consume_sparks", { amount });
  if (error) throw new Error(`Failed to deduct Sparks: ${error.message}`);
  return data as number;
}
