/** Server-side profile helpers — call from route handlers only. */
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/tier";

/**
 * Returns the logged-in user's profile (with lazy monthly Sparks reset applied),
 * or null if the request has no authenticated user.
 */
export async function getProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase.rpc("get_profile");
  if (error) throw new Error(`Failed to load profile: ${error.message}`);
  return data as Profile;
}

/** Atomically deduct Sparks for the logged-in user. Returns the new balance. */
export async function consumeSparks(amount: number): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("consume_sparks", { amount });
  if (error) throw new Error(`Failed to deduct Sparks: ${error.message}`);
  return data as number;
}
