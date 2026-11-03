/**
 * POST /api/stripe/checkout — start a Pro subscription checkout.
 *
 * Body {interval: "month" | "year"} (default month). Uses STRIPE_PRICE_PRO / STRIPE_PRICE_PRO_YEARLY
 * if set; otherwise creates the $28/mo or $276/yr price inline so
 * the flow works with nothing but STRIPE_SECRET_KEY configured.
 * The webhook (app/api/stripe/webhook) flips the profile to Pro on completion.
 */
import { NextRequest, NextResponse } from "next/server";
import { getStripe, PRO_PRICE_CENTS, PRO_YEARLY_PRICE_CENTS } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/profile";
import { resolveBillingState } from "@/lib/stripe-billing";
import { validateProPrice } from "@/lib/checkout-price";

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
  const body = (await req.json().catch(() => ({}))) as { interval?: unknown };
  const interval = body?.interval === "year" ? "year" : "month";
  const yearly = interval === "year";
  const configuredPrice = yearly ? process.env.STRIPE_PRICE_PRO_YEARLY : process.env.STRIPE_PRICE_PRO;
  const advertisedCents = yearly ? PRO_YEARLY_PRICE_CENTS : PRO_PRICE_CENTS;
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

    // A configured Stripe Price must match the amount shown on the pricing
    // page. Never open a checkout that could charge more than advertised.
    if (configuredPrice) {
      const price = await stripe.prices.retrieve(configuredPrice);
      if (!validateProPrice(price, advertisedCents, interval)) {
        throw new Error(`The Pro checkout price does not match the advertised ${yearly ? "$276 USD/year" : "$28 USD/month"}. Please contact support.`);
      }
    }
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [
        configuredPrice
          ? { price: configuredPrice, quantity: 1 }
          : {
              price_data: {
                currency: "usd",
                unit_amount: advertisedCents,
                recurring: { interval },
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
      metadata: { user_id: user.id, billing_interval: interval },
      subscription_data: { metadata: { user_id: user.id, billing_interval: interval } },
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
