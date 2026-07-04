/** User tiers. Tier lives on the Supabase `profiles` row — see lib/profile.ts. */
export type Tier = "free" | "pro";

/** Monthly Sparks allowance per tier. Keep in sync with tier_allowance() in
 *  supabase/migrations/001_sparks_profiles.sql. */
export const SPARKS_ALLOWANCE: Record<Tier, number> = {
  free: 60,
  pro: 500,
};

export type Profile = {
  id: string;
  tier: Tier;
  sparks: number;
  sparks_reset_at: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
};
