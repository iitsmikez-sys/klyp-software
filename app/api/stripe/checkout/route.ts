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
import { OFFER_COOKIE, offerCookieActive } from "@/lib/offer-cookie";
import { ensureFirstMonthCoupon, firstMonthOfferAvailable, isNewCustomer, FIRST_MONTH_PRICE_CENTS } from "@/lib/first-month-offer";

export const runtime = "nodejs";

/** Did this person arrive from the ad link? The proxy saved that in a cookie. */
const hasOfferLink = (req: NextRequest) => offerCookieActive(req.cookies.get(OFFER_COOKIE)?.value);

/** GET /api/stripe/checkout — does the signed-in person qualify for the $17 first month? */
export async function GET(req: NextRequest) {
  try {
    const profile = await getProfile();
    const offered = firstMonthOfferAvailable(profile, process.env, hasOfferLink(req));
    return NextResponse.json({
      first_month: offered ? { price_cents: FIRST_MONTH_PRICE_CENTS } : null,
      // New monthly subscribers without the ad offer can type a promo code on Stripe's checkout page.
      promo_code_field: !offered && isNewCustomer(profile),
    });
  } catch {
    return NextResponse.json({ first_month: null, promo_code_field: false });
  }
}

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
    // New monthly subscribers pay $17 for the first month (lib/first-month-offer.ts). Stripe also
    // confirms they have never been a customer, so a returning person pays the full price.
    const newMonthly = !yearly && !billing.checkoutCustomerId && isNewCustomer(profile);
    const firstMonth = newMonthly && firstMonthOfferAvailable(profile, process.env, hasOfferLink(req));
    // Stripe does not allow a preset discount and the promo code box together: ad-link visitors get the
    // preset $17, other new monthly subscribers get the box (codes are made in the Stripe dashboard).
    const promoField = newMonthly && !firstMonth;
    const couponId = firstMonth ? await ensureFirstMonthCoupon(stripe) : null;
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      ...(couponId ? { discounts: [{ coupon: couponId }] } : {}),
      ...(promoField ? { allow_promotion_codes: true } : {}),
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
