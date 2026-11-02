/**
 * Catch-up for Stripe webhooks that were delayed or never delivered.
 *
 * Reads a customer's subscriptions straight from Stripe and applies them with the
 * SAME rules as app/api/stripe/webhook/route.ts: Sparks and Pro come only from a
 * PAID first/cycle invoice of an active subscription, Pro is revoked for a
 * subscription that is no longer active, and the grant is keyed by invoice id —
 * grant_tier_sparks raises unique_violation (23505) for an invoice that was
 * already granted, which is swallowed. So a sync and the webhook can never grant
 * the same billing period twice, whichever gets there first, and running a sync
 * repeatedly changes nothing.
 *
 * Callers: /api/stripe/sync (one signed-in user, right after checkout) and
 * /api/stripe/reconcile (daily sweep). The Stripe and database clients are
 * injected, so tests never touch a real account.
 *
 * NOTE: grantTier/revoke below mirror the webhook's private helpers on purpose
 * (the webhook route is covered by tests that load it in isolation); keep the two
 * in step if either changes.
 */
import { SPARKS_ALLOWANCE } from "./tier.ts";

type IdOrObject = string | { id: string } | null | undefined;

export type InvoiceLike = {
  id: string;
  status?: string | null;
  billing_reason?: string | null;
};

export type SubscriptionLike = {
  id: string;
  status: string;
  customer: IdOrObject;
  latest_invoice?: InvoiceLike | string | null;
};

export type StripeSyncClient = {
  subscriptions: {
    list(params: Record<string, unknown>): Promise<{ data: SubscriptionLike[] }>;
    search(params: Record<string, unknown>): Promise<{ data: SubscriptionLike[] }>;
  };
};

type DbError = { code?: string; message: string } | null;
/** The slice of a Supabase admin client this module uses. */
export type SyncAdmin = {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data?: unknown; error: DbError }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idOf = (v: IdOrObject): string | undefined => (!v ? undefined : typeof v === "string" ? v : v.id);
const isActive = (status: string) => status === "active" || status === "trialing";

export type SyncOutcome = {
  subscriptionId: string;
  action: "granted" | "already_granted" | "revoked" | "unchanged";
};

async function grantFirstOrCycleInvoice(admin: SyncAdmin, userId: string, customerId: string | undefined, subscriptionId: string, invoiceId: string): Promise<"granted" | "already_granted"> {
  const { error } = await admin.rpc("grant_tier_sparks", {
    p_user_id: userId,
    p_match_customer_id: null,
    p_tier: "pro",
    p_balance: SPARKS_ALLOWANCE.pro,
    p_reset_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    p_event_id: invoiceId,
    p_reason: "invoice_grant",
    p_customer_id: customerId ?? null,
    p_subscription_id: subscriptionId,
    p_set_subscription: true,
  });
  // Same invoice already granted (by the webhook or an earlier sync): nothing to do.
  if (error?.code === "23505") return "already_granted";
  if (error) throw new Error(`Supabase Sparks grant failed: ${error.message}`);
  return "granted";
}

async function revokeIfCurrent(admin: SyncAdmin, userId: string, subscriptionId: string): Promise<boolean> {
  const { data, error } = await admin
    .from("profiles")
    .update({ tier: "free", stripe_subscription_id: null })
    .select("id")
    .eq("stripe_subscription_id", subscriptionId)
    .eq("id", userId);
  if (error) throw new Error(`Supabase profile update failed: ${error.message}`);
  return Array.isArray(data) && data.length > 0;
}

/** Bring one user's plan in line with what Stripe says right now. */
export async function syncUserFromStripe(opts: {
  stripe: StripeSyncClient;
  admin: SyncAdmin;
  userId: string;
  customerId: string | null;
}): Promise<{ subscriptions: number; outcomes: SyncOutcome[] }> {
  const { stripe, admin, userId, customerId } = opts;
  if (!UUID.test(userId)) throw new Error("syncUserFromStripe: invalid user id");

  const subs = customerId
    ? (await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 20, expand: ["data.latest_invoice"] })).data
    : // The profile has no customer id yet (the webhook never arrived): find the subscription by
      // the user_id Klyp stamps into its metadata at checkout.
      (await stripe.subscriptions.search({ query: `metadata['user_id']:'${userId}'`, limit: 20, expand: ["data.latest_invoice"] })).data;

  const outcomes: SyncOutcome[] = [];
  for (const sub of subs) {
    if (isActive(sub.status)) {
      const invoice = typeof sub.latest_invoice === "object" ? sub.latest_invoice : null;
      const eligible = invoice && invoice.status === "paid" &&
        (invoice.billing_reason === "subscription_create" || invoice.billing_reason === "subscription_cycle");
      if (!eligible) {
        outcomes.push({ subscriptionId: sub.id, action: "unchanged" });
        continue;
      }
      const action = await grantFirstOrCycleInvoice(admin, userId, idOf(sub.customer), sub.id, invoice.id);
      outcomes.push({ subscriptionId: sub.id, action });
    } else {
      // Not active any more: only revoke if it is the subscription this profile is on.
      const revoked = await revokeIfCurrent(admin, userId, sub.id);
      outcomes.push({ subscriptionId: sub.id, action: revoked ? "revoked" : "unchanged" });
    }
  }
  return { subscriptions: subs.length, outcomes };
}

export type ReconcileSummary = {
  checked: number;
  changed: number;
  failed: number;
  errors: { userId: string; message: string }[];
};

/**
 * Daily sweep. Pro subscribers whose renewal date passed more than two days ago have
 * had no paid-invoice grant since: either the renewal webhook was missed, or the
 * subscription ended and its cancellation was missed. Both are settled by asking Stripe.
 */
export async function reconcileStuckPro(opts: {
  stripe: StripeSyncClient;
  admin: SyncAdmin;
  limit?: number;
  now?: number;
}): Promise<ReconcileSummary> {
  const cutoff = new Date((opts.now ?? Date.now()) - 2 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await opts.admin
    .from("profiles")
    .select("id, stripe_customer_id")
    .eq("tier", "pro")
    .not("stripe_subscription_id", "is", null)
    .lt("sparks_reset_at", cutoff)
    .limit(opts.limit ?? 200);
  if (error) throw new Error(`Could not list subscribers to check: ${error.message}`);

  const summary: ReconcileSummary = { checked: 0, changed: 0, failed: 0, errors: [] };
  for (const row of (data ?? []) as { id: string; stripe_customer_id: string | null }[]) {
    summary.checked++;
    try {
      const res = await syncUserFromStripe({ stripe: opts.stripe, admin: opts.admin, userId: row.id, customerId: row.stripe_customer_id });
      if (res.outcomes.some((o) => o.action === "granted" || o.action === "revoked")) summary.changed++;
    } catch (err) {
      // One bad customer must not stop the sweep.
      summary.failed++;
      summary.errors.push({ userId: row.id, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return summary;
}
