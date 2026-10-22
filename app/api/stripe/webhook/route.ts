/**
 * POST /api/stripe/webhook — keeps Supabase profiles in sync with Stripe.
 *
 *   checkout.session.completed      → remember customer ID, without granting access
 *   invoice.paid                    → grant Pro Sparks for a paid new/renewal invoice
 *   customer.subscription.updated   → downgrade terminal subscriptions only
 *   customer.subscription.deleted   → downgrade without granting Sparks
 *
 * Local dev: stripe listen --forward-to localhost:3000/api/stripe/webhook
 * (copy the printed whsec_… into STRIPE_WEBHOOK_SECRET).
 */
import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { paidSubscriptionGrant, paidSubscriptionIsActive, shouldDowngradeSubscription, type PaidSubscriptionGrant } from "@/lib/stripe-payment";

export const runtime = "nodejs";

/** Normalize a possibly-expanded Stripe reference field down to its ID. */
function idOf(value: string | { id: string } | null | undefined): string | undefined {
  if (!value) return undefined;
  return typeof value === "string" ? value : value.id;
}

/** Grant only a paid billing period; the SQL function serializes and dedupes. */
async function grantPaidInvoice(grant: PaidSubscriptionGrant) {
  const admin = createAdminClient();
  const { error } = await admin.rpc("grant_paid_invoice_sparks", {
    p_user_id: grant.userId ?? null,
    p_match_customer_id: grant.customerId ?? null,
    p_invoice_id: grant.invoiceId,
    p_period_start: new Date(grant.periodStart * 1000).toISOString(),
    p_period_end: new Date(grant.periodEnd * 1000).toISOString(),
    p_customer_id: grant.customerId ?? null,
    p_subscription_id: grant.subscriptionId,
    p_paid_event_created: new Date(grant.paidEventCreated * 1000).toISOString(),
  });
  if (error) throw new Error(`Supabase paid-invoice grant failed: ${error.message}`);
}

/** Sync tier/subscription state only — does not touch the Sparks balance. */
async function downgradeSubscription(
  match: { userId?: string; customerId?: string }, subscriptionId: string, eventCreated: number
) {
  const admin = createAdminClient();
  const { error } = await admin.rpc("downgrade_subscription_if_current", {
    p_user_id: match.userId ?? null,
    p_match_customer_id: match.customerId ?? null,
    p_subscription_id: subscriptionId,
    p_terminal_event_created: new Date(eventCreated * 1000).toISOString(),
  });
  if (error) throw new Error(`Supabase profile downgrade failed: ${error.message}`);
}

async function restorePaidSubscription(
  match: { userId?: string; customerId?: string }, subscriptionId: string, eventCreated: number
) {
  const admin = createAdminClient();
  const { error } = await admin.rpc("restore_paid_subscription_if_current", {
    p_user_id: match.userId ?? null,
    p_match_customer_id: match.customerId ?? null,
    p_subscription_id: subscriptionId,
    p_terminal_event_created: new Date(eventCreated * 1000).toISOString(),
  });
  if (error) throw new Error(`Supabase paid subscription restore failed: ${error.message}`);
}

async function handleTerminalSubscription(sub: Stripe.Subscription, eventCreated: number) {
  const stripe = getStripe();
  const match = { userId: sub.metadata?.user_id, customerId: idOf(sub.customer) };
  const current = await stripe.subscriptions.retrieve(sub.id);
  if (current.status === "active") {
    await restorePaidSubscription(match, sub.id, eventCreated);
    return;
  }
  if (!shouldDowngradeSubscription(current.status)) return;
  await downgradeSubscription(match, sub.id, eventCreated);
  // If a payment raced the downgrade, restore the previously paid tier.
  // A retry after a failed second lookup also takes the active branch above.
  const after = await stripe.subscriptions.retrieve(sub.id);
  if (after.status === "active") await restorePaidSubscription(match, sub.id, eventCreated);
}

/** Checkout identifies the profile, but payment may still be pending. */
async function linkCheckoutBilling(userId: string, session: Stripe.Checkout.Session) {
  const customerId = idOf(session.customer);
  if (!customerId) return;
  const admin = createAdminClient();
  const { data, error } = await admin.from("profiles")
    .update({ stripe_customer_id: customerId })
    .eq("id", userId).select("id");
  if (error) throw new Error(`Could not link Stripe checkout: ${error.message}`);
  if (!data?.length) throw new Error(`No profile matched checkout user ${userId}`);
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

  try {
    // The invoice-ID ledger check is atomic with the balance update. Repeated
    // status/customer writes are idempotent, so each delivery can run safely.
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const userId = session.metadata?.user_id ?? session.client_reference_id;
        if (userId && session.mode === "subscription") {
          await linkCheckoutBilling(userId, session);
        }
        break;
      }
      case "invoice.paid": {
        const grant = paidSubscriptionGrant(event);
        if (grant) {
          const subscription = await getStripe().subscriptions.retrieve(grant.subscriptionId);
          if (!paidSubscriptionIsActive(subscription, grant)) break;
          await grantPaidInvoice({ ...grant, userId: subscription.metadata.user_id });
        }
        break;
      }
      case "customer.subscription.updated": {
        const sub = event.data.object;
        if (shouldDowngradeSubscription(sub.status)) {
          await handleTerminalSubscription(sub, event.created);
        }
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        await handleTerminalSubscription(sub, event.created);
        break;
      }
      // Everything else is noise for us — acknowledge and move on.
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Webhook handling failed." },
      { status: 500 }
    );
  }

  return NextResponse.json({ received: true });
}
