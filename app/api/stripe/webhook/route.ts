/**
 * POST /api/stripe/webhook — keeps Supabase profiles in sync with Stripe.
 *
 *   checkout.session.completed      → tier=pro, grant a full Sparks allotment (new subscription)
 *   invoice.paid                    → grant a full Sparks allotment (billing-cycle renewal)
 *   customer.subscription.updated   → sync tier pro/free while active/trialing/past_due — does NOT
 *                                      touch Sparks (a card update or status flicker shouldn't refill
 *                                      the user outside their actual billing cycle)
 *   customer.subscription.deleted   → tier=free, grant the Free allotment
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
 * Returns false when the event has already been applied. If the table is
 * missing (migration 007 not yet run) this logs and lets the event through:
 * losing idempotency is bad, but silently refusing to grant Pro to a paying
 * customer would be worse.
 */
async function claimEvent(event: Stripe.Event): Promise<boolean> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("stripe_events")
    .insert({ id: event.id, type: event.type });
  if (!error) return true;

  // 23505 = unique_violation — this event has been handled already.
  if (error.code === "23505") return false;

  // 42P01 = undefined_table, plus PostgREST's schema-cache miss for the same.
  if (error.code === "42P01" || error.code === "PGRST205") {
    console.warn(
      "[stripe webhook] public.stripe_events is missing — processing without " +
        "idempotency. Apply supabase/migrations/007_stripe_event_idempotency.sql."
    );
    return true;
  }
  throw new Error(`Could not record Stripe event: ${error.message}`);
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
  extra: Partial<{ stripe_customer_id: string; stripe_subscription_id: string | null }> = {}
) {
  const admin = createAdminClient();
  const update = {
    tier,
    sparks: SPARKS_ALLOWANCE[tier],
    sparks_reset_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    ...extra,
  };
  // select() so the result reports which rows changed: an update that matches
  // nothing is not an error in PostgREST, and silently granting nothing to a
  // customer who has just paid is the worst possible failure here. Throwing
  // returns a non-2xx, so Stripe retries and the event stays visible as failed.
  const query = admin.from("profiles").update(update).select("id");
  const { data, error } = match.userId
    ? await query.eq("id", match.userId)
    : await query.eq("stripe_customer_id", match.customerId!);
  if (error) throw new Error(`Supabase profile update failed: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error(
      `No profile matched ${match.userId ? `user ${match.userId}` : `customer ${match.customerId}`} — tier not granted.`
    );
  }
}

/** Sync tier/subscription state only — does not touch the Sparks balance. */
async function syncTierOnly(
  match: { userId?: string; customerId?: string },
  tier: Tier,
  extra: Partial<{ stripe_subscription_id: string | null }> = {}
) {
  const admin = createAdminClient();
  const update = { tier, ...extra };
  const query = admin.from("profiles").update(update).select("id");
  const { data, error } = match.userId
    ? await query.eq("id", match.userId)
    : await query.eq("stripe_customer_id", match.customerId!);
  if (error) throw new Error(`Supabase profile update failed: ${error.message}`);
  if (!data || data.length === 0) {
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

  try {
    // Duplicate deliveries stop here, before anything is granted.
    if (!(await claimEvent(event))) {
      return NextResponse.json({ received: true, duplicate: true });
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const userId = session.metadata?.user_id ?? session.client_reference_id;
        if (userId && session.mode === "subscription") {
          await grantTier({ userId }, "pro", {
            stripe_customer_id: idOf(session.customer),
            stripe_subscription_id: idOf(session.subscription),
          });
        }
        break;
      }
      case "invoice.paid": {
        // Billing-cycle renewal (and, redundantly-but-harmlessly, the first
        // invoice of a brand-new subscription — checkout.session.completed
        // already grants the same allotment for that case). Only invoices
        // generated by a subscription represent a Sparks-relevant cycle.
        const invoice = event.data.object;
        const subDetails = invoice.parent?.subscription_details;
        const subscriptionId = idOf(subDetails?.subscription);
        if (subscriptionId) {
          await grantTier(
            { userId: subDetails?.metadata?.user_id, customerId: idOf(invoice.customer) },
            "pro",
            { stripe_subscription_id: subscriptionId }
          );
        }
        break;
      }
      case "customer.subscription.updated": {
        const sub = event.data.object;
        const active = sub.status === "active" || sub.status === "trialing" || sub.status === "past_due";
        await syncTierOnly(
          { userId: sub.metadata?.user_id, customerId: idOf(sub.customer) },
          active ? "pro" : "free",
          { stripe_subscription_id: active ? sub.id : null }
        );
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        await grantTier(
          { userId: sub.metadata?.user_id, customerId: idOf(sub.customer) },
          "free",
          { stripe_subscription_id: null }
        );
        break;
      }
      // Everything else is noise for us — acknowledge and move on.
    }
  } catch (err) {
    // Non-2xx makes Stripe retry the event — right call for transient DB errors.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Webhook handling failed." },
      { status: 500 }
    );
  }

  return NextResponse.json({ received: true });
}
