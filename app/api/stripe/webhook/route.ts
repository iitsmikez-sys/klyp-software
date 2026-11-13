/**
 * POST /api/stripe/webhook — keeps Supabase profiles in sync with Stripe.
 *
 *   checkout.session.completed      → a paid Spark pack adds its Sparks once; subscriptions wait for the paid invoice
 *   invoice.paid                    → grant a full Sparks allotment (first payment or renewal)
 *   customer.subscription.updated   → revoke Pro on unpaid/inactive status; never grant Pro
 *   customer.subscription.deleted   → revoke Pro without refilling Sparks
 *   invoice.voided                  → a paused subscription's renewal: Free until billing resumes
 *
 * Local dev: stripe listen --forward-to localhost:3000/api/stripe/webhook
 * (copy the printed whsec_… into STRIPE_WEBHOOK_SECRET).
 */
import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { SPARKS_ALLOWANCE, type Tier } from "@/lib/tier";
import { TRIAL_SPARKS, cardTrialKey, emailTrialKey } from "@/lib/pro-trial";
import { claimTrialKeys } from "@/lib/trial-uses";
import { isPackSession, packForSession } from "@/lib/spark-packs";

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
  extra: Partial<{ stripe_customer_id: string; stripe_subscription_id: string | null }> = {},
  /** Sparks to set instead of the plan's full allowance (the free trial starts with fewer). */
  balance?: number
) {
  const admin = createAdminClient();
  const { error } = await admin.rpc("grant_tier_sparks", {
    p_user_id: match.userId ?? null,
    p_match_customer_id: match.customerId ?? null,
    p_tier: tier,
    p_balance: balance ?? SPARKS_ALLOWANCE[tier],
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

/** "year" for a yearly subscription, otherwise "month" (also when the price is not visible on the object). */
function intervalOf(sub: { items?: { data?: Array<{ price?: { recurring?: { interval?: string } | null } }> } }): "month" | "year" {
  return sub.items?.data?.[0]?.price?.recurring?.interval === "year" ? "year" : "month";
}

/** Record how this subscription is billed; a yearly subscriber gets its Sparks refilled monthly by a daily job. */
async function setBillingInterval(subscriptionId: string, interval: "month" | "year") {
  const { error } = await createAdminClient().from("profiles")
    .update({ billing_interval: interval }).eq("stripe_subscription_id", subscriptionId);
  if (error) throw new Error(`Supabase billing interval update failed: ${error.message}`);
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
      case "checkout.session.completed": {
        // A Spark pack is a one-time payment. Subscriptions are granted by invoice.paid below, not here.
        const session = event.data.object;
        if (isPackSession(session) && session.payment_status === "paid") {
          const pack = packForSession(session);
          const userId = session.metadata?.user_id;
          if (!pack || !userId || session.client_reference_id !== userId) {
            throw new Error(`Spark pack session ${session.id} does not match a pack or its buyer; nothing was granted.`);
          }
          const { error } = await createAdminClient().rpc("add_pack_sparks", { p_user_id: userId, p_sparks: pack.sparks, p_reference: session.id });
          if (error && error.code !== "23505") throw new Error(`Supabase Spark pack grant failed: ${error.message}`);
        }
        break;
      }
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
          // The free trial's first invoice is $0. The trial starts with a smaller Sparks balance (the full 500 come with the first real
          // payment, a "subscription_cycle" invoice), and a second trial on the same email or the same card is cancelled before it gives anything.
          const trialStart = current.status === "trialing" && invoice.amount_paid === 0 && invoice.billing_reason === "subscription_create" &&
            subDetails?.metadata?.trial === "1";
          if (trialStart) {
            const trialUserId = subDetails?.metadata?.user_id;
            if (trialUserId) {
              const keys = [emailTrialKey(invoice.customer_email)];
              const withCard = await getStripe().subscriptions.retrieve(subscriptionId, { expand: ["default_payment_method"] });
              const method = withCard.default_payment_method;
              const fingerprint = method && typeof method === "object" ? method.card?.fingerprint : null;
              if (fingerprint) keys.push(cardTrialKey(fingerprint));
              if ((await claimTrialKeys(trialUserId, keys)) === "used") {
                console.warn(`[stripe] trial refused: this email or card already had a free trial (subscription ${subscriptionId})`);
                await getStripe().subscriptions.cancel(subscriptionId);
                break;
              }
            }
          }
          await grantTier(
            { userId: subDetails?.metadata?.user_id, customerId: idOf(invoice.customer) },
            "pro",
            invoice.id,
            "invoice_grant",
            { stripe_customer_id: idOf(invoice.customer), stripe_subscription_id: subscriptionId },
            trialStart ? TRIAL_SPARKS : undefined
          );
          await setBillingInterval(subscriptionId, intervalOf(current));
        }
        break;
      }
      case "customer.subscription.updated": {
        const sub = event.data.object;
        // A plan switch (monthly to yearly) arrives here. Keep the stored interval in step with Stripe;
        // this changes no tier and grants nothing.
        if (sub.status === "active") await setBillingInterval(sub.id, intervalOf(sub));
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
      case "invoice.voided": {
        // A paused subscription's renewal invoice is voided instead of charged. The period the person
        // paid for has ended, so they are on Free until billing resumes (the first paid invoice after
        // the pause grants Pro and a fresh allowance through the invoice.paid case above).
        const invoice = event.data.object;
        const subDetails = invoice.parent?.subscription_details;
        const subscriptionId = idOf(subDetails?.subscription);
        if (subscriptionId && invoice.billing_reason === "subscription_cycle") {
          const current = await getStripe().subscriptions.retrieve(subscriptionId);
          if (current.pause_collection && (current.status === "active" || current.status === "trialing")) {
            await syncTierOnly(
              { userId: subDetails?.metadata?.user_id, customerId: idOf(invoice.customer) },
              "free",
              {},
              subscriptionId
            );
          }
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
