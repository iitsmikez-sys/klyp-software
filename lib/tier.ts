/** User tiers. Tier lives on the Supabase `profiles` row — see lib/profile.ts. */
export type Tier = "free" | "pro";

/** Sparks allowance per 30-day cycle. Keep in sync with the latest
 *  tier_allowance() migration. */
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
  vertical_layout?: import("./vertical-layout").VerticalLayoutV1 | null;
};
