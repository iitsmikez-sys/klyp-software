/**
 * POST /api/stripe/checkout — start a Pro subscription checkout.
 *
 * Uses STRIPE_PRICE_PRO if set; otherwise creates the $28/mo price inline so
 * the flow works with nothing but STRIPE_SECRET_KEY configured.
 * The webhook (app/api/stripe/webhook) flips the profile to Pro on completion.
 */
import { NextRequest, NextResponse } from "next/server";
import { getStripe, PRO_PRICE_CENTS } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/profile";
import { resolveBillingState } from "@/lib/stripe-billing";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to upgrade." }, { status: 401 });
  }

  let profile;
  try {
    profile = await getProfile();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load profile." },
      { status: 500 }
    );
  }
  const origin = req.nextUrl.origin;
  try {
    const stripe = getStripe();
    const billing = await resolveBillingState(stripe, {
      stripe_customer_id: profile?.stripe_customer_id ?? null,
      stripe_subscription_id: profile?.stripe_subscription_id ?? null,
    });
    if (billing.portalCustomerId) {
      return NextResponse.json({ error: "You're already subscribed. Open Manage billing instead." }, { status: 400 });
    }

    // The UI advertises PRO_PRICE_CENTS, but when STRIPE_PRICE_PRO is set it
    // is Stripe's price that is actually charged — nothing kept the two in
    // step, and they had drifted ($28 advertised, $29 charged). Checkout is
    // not blocked over it (refusing a sale is worse), but the mismatch is
    // logged loudly so it can't ship unnoticed.
    if (process.env.STRIPE_PRICE_PRO) {
      try {
        const price = await stripe.prices.retrieve(process.env.STRIPE_PRICE_PRO);
        if (price.unit_amount !== PRO_PRICE_CENTS) {
          console.error(
            `[stripe checkout] PRICE MISMATCH — the app advertises ${(PRO_PRICE_CENTS / 100).toFixed(2)} ` +
              `but STRIPE_PRICE_PRO (${price.id}) charges ${((price.unit_amount ?? 0) / 100).toFixed(2)} ` +
              `${price.currency.toUpperCase()}. Customers are charged the Stripe amount.`
          );
        }
        if (price.recurring?.interval !== "month") {
          console.error(
            `[stripe checkout] BILLING INTERVAL MISMATCH — the app advertises monthly billing but ` +
              `${price.id} recurs per ${price.recurring?.interval ?? "one-time"}.`
          );
        }
      } catch (priceErr) {
        console.error("[stripe checkout] could not verify STRIPE_PRICE_PRO:", priceErr);
      }
    }
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [
        process.env.STRIPE_PRICE_PRO
          ? { price: process.env.STRIPE_PRICE_PRO, quantity: 1 }
          : {
              price_data: {
                currency: "usd",
                unit_amount: PRO_PRICE_CENTS,
                recurring: { interval: "month" },
                product_data: {
                  name: "Klyp Pro",
                  description: "500 Sparks/month, no watermark",
                },
              },
              quantity: 1,
            },
      ],
      // Reuse the Stripe customer if this user subscribed before.
      ...(billing.checkoutCustomerId
        ? { customer: billing.checkoutCustomerId }
        : { customer_email: user.email ?? undefined }),
      client_reference_id: user.id,
      metadata: { user_id: user.id },
      subscription_data: { metadata: { user_id: user.id } },
      success_url: `${origin}/dashboard?upgraded=1`,
      cancel_url: `${origin}/dashboard`,
    });
    return NextResponse.json({ url: session.url });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to start checkout." },
      { status: 500 }
    );
  }
}
