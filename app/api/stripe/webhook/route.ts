/**
 * POST /api/stripe/webhook — keeps Supabase profiles in sync with Stripe.
 *
 *   checkout.session.completed      → acknowledged; waits for paid invoice
 *   invoice.paid                    → grant a full Sparks allotment (first payment or renewal)
 *   customer.subscription.updated   → revoke Pro on unpaid/inactive status; never grant Pro
 *   customer.subscription.deleted   → revoke Pro without refilling Sparks
 *
 * Local dev: stripe listen --forward-to localhost:3000/api/stripe/webhook
 * (copy the printed whsec_… into STRIPE_WEBHOOK_SECRET).
 */
import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { SPARKS_ALLOWANCE, type Tier } from "@/lib/tier";

export const runtime = "nodejs";

/**
 * Claim this event id so a redelivery can't apply it twice. Stripe delivers at
 * least once — any timeout or non-2xx makes it retry — and each grant resets
 * Sparks to the full allowance, so a replay used to refill a spent balance
 * (verified in test mode: a replayed checkout.session.completed took a profile
 * from 100 back to 500).
 *
 * Returns false when already applied. A missing claim table fails with 500 so
 * Stripe can retry after migration 007 is installed.
 */
async function claimEvent(event: Stripe.Event): Promise<boolean> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("stripe_events")
    .insert({ id: event.id, type: event.type });
  if (!error) return true;

  // 23505 = unique_violation — this event has been handled already.
  if (error.code === "23505") return false;

  // Do not process without the unique event claim. A 500 makes Stripe retry
  // after the required migration is applied, instead of refilling twice.
  throw new Error(`Could not record Stripe event: ${error.message}`);
}

/**
 * Give the claim back after a failed handler.
 *
 * claimEvent() inserts before the work happens, so a grant that throws leaves
 * the event claimed but ungranted. Stripe retries on the 500, the retry sees
 * the existing row and returns "duplicate" — and a customer who paid never
 * receives their Sparks, silently. Releasing the claim makes the retry redo
 * the work, which is the point of returning a non-2xx at all.
 */
async function releaseEvent(eventId: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("stripe_events").delete().eq("id", eventId);
  if (error) {
    // Loud: from here the retry is treated as a duplicate and the grant is
    // lost, so this needs a human rather than a quiet log line.
    console.error(
      `[stripe webhook] FAILED to release the claim on ${eventId} after a ` +
        `handler error — Stripe's retry will be rejected as a duplicate and ` +
        `this payment may never be granted: ${error.message}`
    );
  }
}

/** Normalize a possibly-expanded Stripe reference field down to its ID. */
function idOf(value: string | { id: string } | null | undefined): string | undefined {
  if (!value) return undefined;
  return typeof value === "string" ? value : value.id;
}

/** Grant a fresh Sparks allotment for a new billing cycle (new subscription or renewal). */
async function grantTier(
  match: { userId?: string; customerId?: string },
  tier: Tier,
  eventId: string,
  reason: "checkout_grant" | "invoice_grant" | "subscription_deleted",
  extra: Partial<{ stripe_customer_id: string; stripe_subscription_id: string | null }> = {}
) {
  const admin = createAdminClient();
  const { error } = await admin.rpc("grant_tier_sparks", {
    p_user_id: match.userId ?? null,
    p_match_customer_id: match.customerId ?? null,
    p_tier: tier,
    p_balance: SPARKS_ALLOWANCE[tier],
    p_reset_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    p_event_id: eventId,
    p_reason: reason,
    p_customer_id: extra.stripe_customer_id ?? null,
    p_subscription_id: extra.stripe_subscription_id ?? null,
    p_set_subscription: Object.prototype.hasOwnProperty.call(extra, "stripe_subscription_id"),
  });
  if (error?.code === "23505" && reason === "invoice_grant") return;
  if (error) throw new Error(`Supabase Sparks grant failed: ${error.message}`);
}

/** Sync tier/subscription state only — does not touch the Sparks balance. */
async function syncTierOnly(
  match: { userId?: string; customerId?: string },
  tier: Tier,
  extra: Partial<{ stripe_subscription_id: string | null }> = {},
  expectedSubscriptionId?: string
) {
  const admin = createAdminClient();
  const update = { tier, ...extra };
  let query = admin.from("profiles").update(update).select("id");
  if (expectedSubscriptionId) query = query.eq("stripe_subscription_id", expectedSubscriptionId);
  const { data, error } = match.userId
    ? await query.eq("id", match.userId)
    : await query.eq("stripe_customer_id", match.customerId!);
  if (error) throw new Error(`Supabase profile update failed: ${error.message}`);
  if ((!data || data.length === 0) && !expectedSubscriptionId) {
    throw new Error(
      `No profile matched ${match.userId ? `user ${match.userId}` : `customer ${match.customerId}`} — tier not synced.`
    );
  }
}

export async function POST(req: NextRequest) {
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "STRIPE_WEBHOOK_SECRET is not set." }, { status: 500 });
  }

  const payload = await req.text();
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature header." }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(payload, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return NextResponse.json(
      { error: `Webhook signature verification failed: ${err instanceof Error ? err.message : err}` },
      { status: 400 }
    );
  }

  let claimed = false;
  try {
    // Duplicate deliveries stop here, before anything is granted.
    if (!(await claimEvent(event))) {
      return NextResponse.json({ received: true, duplicate: true });
    }
    claimed = true;

    switch (event.type) {
      case "invoice.paid": {
        // The first paid invoice and each paid renewal are the single sources
        // of Sparks grants. Checkout may complete before delayed payment clears.
        const invoice = event.data.object;
        const subDetails = invoice.parent?.subscription_details;
        const subscriptionId = idOf(subDetails?.subscription);
        if (subscriptionId && (invoice.billing_reason === "subscription_create" ||
            invoice.billing_reason === "subscription_cycle")) {
          // A delayed invoice event must not reactivate a subscription that
          // has since become unpaid or been cancelled, or refill a later cycle.
          const current = await getStripe().subscriptions.retrieve(subscriptionId);
          if (current.status !== "active" && current.status !== "trialing") break;
          const latestInvoiceId = idOf(current.latest_invoice);
          if (!latestInvoiceId) throw new Error(`Subscription ${subscriptionId} has no latest invoice yet.`);
          if (latestInvoiceId !== invoice.id) break;
          await grantTier(
            { userId: subDetails?.metadata?.user_id, customerId: idOf(invoice.customer) },
            "pro",
            invoice.id,
            "invoice_grant",
            { stripe_customer_id: idOf(invoice.customer), stripe_subscription_id: subscriptionId }
          );
        }
        break;
      }
      case "customer.subscription.updated": {
        const sub = event.data.object;
        // A status update is not proof of payment. Only invoice.paid may
        // activate Pro, including after a failed payment is recovered.
        if (sub.status !== "active" && sub.status !== "trialing") {
          // Webhooks can arrive out of order. A stale past_due event must not
          // undo a newer paid invoice that restored this subscription.
          const current = await getStripe().subscriptions.retrieve(sub.id);
          if (current.status === "active" || current.status === "trialing") break;
          await syncTierOnly(
            { userId: sub.metadata?.user_id, customerId: idOf(sub.customer) },
            "free",
            { stripe_subscription_id: null },
            sub.id
          );
        }
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        await syncTierOnly(
          { userId: sub.metadata?.user_id, customerId: idOf(sub.customer) },
          "free",
          { stripe_subscription_id: null },
          sub.id
        );
        break;
      }
      // Everything else is noise for us — acknowledge and move on.
    }
  } catch (err) {
    // Non-2xx makes Stripe retry the event — right call for transient DB errors.
    // The claim has to go back first, or that retry is a no-op.
    if (claimed) await releaseEvent(event.id);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Webhook handling failed." },
      { status: 500 }
    );
  }

  return NextResponse.json({ received: true });
}
