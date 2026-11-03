/**
 * Monthly Sparks for yearly subscribers.
 *
 * A yearly Pro subscriber is invoiced once a year, so the invoice-paid grant (webhook / stripe-sync)
 * gives their 500 Sparks only once. This daily sweep tops them up each month: it finds yearly Pro
 * profiles whose refill date has passed, checks with Stripe that the subscription is still active and
 * still yearly, and calls refill_yearly_sparks (migration 041), which grants the month exactly once —
 * the ledger reference is unique, so a re-run, an overlap or a retry cannot double-grant.
 *
 * Stripe and the database are injected so tests never touch a real account.
 */
import { SPARKS_ALLOWANCE } from "./tier.ts";

type DbError = { code?: string; message: string } | null;
export type RefillAdmin = {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data?: unknown; error: DbError }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any;
};
export type RefillStripe = {
  subscriptions: {
    retrieve(id: string): Promise<{ id: string; status: string; items?: { data?: Array<{ price?: { recurring?: { interval?: string } | null } }> } }>;
  };
};

export type RefillSummary = { checked: number; granted: number; skipped: number; failed: number; errors: { userId: string; message: string }[] };

const DAY_MS = 86_400_000;

export async function refillYearlySparks(opts: { stripe: RefillStripe; admin: RefillAdmin; now?: number; limit?: number }): Promise<RefillSummary> {
  const now = opts.now ?? Date.now();
  const { data, error } = await opts.admin
    .from("profiles")
    .select("id, stripe_subscription_id, sparks_reset_at")
    .eq("tier", "pro")
    .eq("billing_interval", "year")
    .not("stripe_subscription_id", "is", null)
    .lte("sparks_reset_at", new Date(now).toISOString())
    .limit(opts.limit ?? 200);
  if (error) throw new Error(`Could not list yearly subscribers to refill: ${error.message}`);

  const summary: RefillSummary = { checked: 0, granted: 0, skipped: 0, failed: 0, errors: [] };
  for (const row of (data ?? []) as { id: string; stripe_subscription_id: string; sparks_reset_at: string }[]) {
    summary.checked++;
    try {
      const sub = await opts.stripe.subscriptions.retrieve(row.stripe_subscription_id);
      const live = sub.status === "active" || sub.status === "trialing";
      const yearly = sub.items?.data?.[0]?.price?.recurring?.interval === "year";
      if (!live || !yearly) { summary.skipped++; continue; } // ended or changed plan: the webhook handles that, no free Sparks here
      const { data: granted, error: rpcError } = await opts.admin.rpc("refill_yearly_sparks", {
        p_user_id: row.id,
        p_subscription_id: row.stripe_subscription_id,
        // One reference per profile refill date: re-running the job for the same month finds it already used.
        p_reference: `yearly-refill:${row.stripe_subscription_id}:${new Date(row.sparks_reset_at).toISOString()}`,
        p_balance: SPARKS_ALLOWANCE.pro,
        p_reset_at: new Date(now + 30 * DAY_MS).toISOString(),
      });
      if (rpcError?.code === "23505") { summary.skipped++; continue; } // this month was already granted
      if (rpcError) throw new Error(rpcError.message);
      if (granted) summary.granted++; else summary.skipped++;
    } catch (err) {
      summary.failed++;
      summary.errors.push({ userId: row.id, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return summary;
}
