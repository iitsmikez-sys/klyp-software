/** User tiers. Tier lives on the Supabase `profiles` row — see lib/profile.ts. */
export type Tier = "free" | "pro";

/** Monthly Sparks allowance per tier. Keep in sync with tier_allowance() in
 *  supabase/migrations/001_sparks_profiles.sql. */
export const SPARKS_ALLOWANCE: Record<Tier, number> = {
  // 60 bought a single typical run (40), so one quiet VOD was the whole free
  // trial and a user learned nothing about what Klyp does well. 150 is three
  // runs: enough to discover that longer, louder streams clip better.
  free: 150,
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
