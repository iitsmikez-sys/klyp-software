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
import { TRIAL_DAYS, TRIAL_PRICE_CENTS, TRIAL_SPARKS, emailTrialKey, proTrialOffered, trialMode } from "@/lib/pro-trial";
import { trialKeysUsedByOthers } from "@/lib/trial-uses";

export const runtime = "nodejs";

/** Did this person arrive from the ad link? The proxy saved that in a cookie. */
const hasOfferLink = (req: NextRequest) => offerCookieActive(req.cookies.get(OFFER_COOKIE)?.value);

/**
 * Is this person offered the free trial (lib/pro-trial.ts)? It also fails closed: if the used-trials table cannot be read (for example
 * its migration is not applied yet), nobody is offered a trial and checkout works as before.
 */
async function trialOffered(req: NextRequest, profile: Awaited<ReturnType<typeof getProfile>>, userId: string | null | undefined, email: string | null | undefined): Promise<boolean> {
  if (!userId || !proTrialOffered(profile, trialMode(), hasOfferLink(req))) return false;
  try { return !(await trialKeysUsedByOthers(userId, [emailTrialKey(email)])); } catch { return false; }
}

/** GET /api/stripe/checkout — does the signed-in person qualify for the free trial or the $17 first month? */
export async function GET(req: NextRequest) {
  try {
    const profile = await getProfile();
    const { data: { user: viewer } } = await (await createClient()).auth.getUser();
    const trial = await trialOffered(req, profile, viewer?.id, viewer?.email);
    // The trial replaces the $17 offer for the same person; the two never show together.
    const offered = !trial && firstMonthOfferAvailable(profile, process.env, hasOfferLink(req));
    return NextResponse.json({
      trial: trial ? { days: TRIAL_DAYS, sparks: TRIAL_SPARKS, price_cents: TRIAL_PRICE_CENTS } : null,
      first_month: offered ? { price_cents: FIRST_MONTH_PRICE_CENTS } : null,
      // New monthly subscribers without the ad offer can type a promo code on Stripe's checkout page.
      promo_code_field: !offered && !trial && isNewCustomer(profile),
    });
  } catch {
    return NextResponse.json({ trial: null, first_month: null, promo_code_field: false });
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
    // The pass takes the place of the promo code box, and ad-link visitors get the $17 first month instead of it: they never stack.
    const trial = newMonthly && await trialOffered(req, profile, user.id, user.email);
    const firstMonth = newMonthly && !trial && firstMonthOfferAvailable(profile, process.env, hasOfferLink(req));
    // Stripe does not allow a preset discount and the promo code box together: ad-link visitors get the
    // preset $17, other new monthly subscribers get the box (codes are made in the Stripe dashboard).
    const promoField = newMonthly && !firstMonth && !trial;
    const couponId = firstMonth ? await ensureFirstMonthCoupon(stripe) : null;
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      ...(couponId ? { discounts: [{ coupon: couponId }] } : {}),
      ...(promoField ? { allow_promotion_codes: true } : {}),
      // A card is always collected for the pass; the $3 and the card together are what keep one person from taking many.
      ...(trial ? { payment_method_collection: "always" as const } : {}),
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
        // The 4-day pass: a one-time charge now. It lands on the first invoice and is paid at checkout, while the monthly price waits out the trial days.
        ...(trial ? [{
          price_data: {
            currency: "usd",
            unit_amount: TRIAL_PRICE_CENTS,
            product_data: { name: `Klyp Pro: ${TRIAL_DAYS}-day pass`, description: `${TRIAL_DAYS} days of Pro, then $28 a month unless you cancel. The pass is not refunded.` },
          },
          quantity: 1,
        }] : []),
      ],
      // Stripe labels the monthly line "4 days free" and cannot rename it, so say plainly under the button what is charged and when.
      ...(trial ? { custom_text: { submit: { message: `You pay $3 today for ${TRIAL_DAYS} days of Pro. After ${TRIAL_DAYS} days your card is charged $28 a month, unless you cancel first from the Upgrade page.` } } } : {}),
      // Reuse the Stripe customer if this user subscribed before.
      ...(billing.checkoutCustomerId
        ? { customer: billing.checkoutCustomerId }
        : { customer_email: user.email ?? undefined }),
      client_reference_id: user.id,
      metadata: { user_id: user.id, billing_interval: interval },
      subscription_data: {
        metadata: { user_id: user.id, billing_interval: interval, ...(trial ? { trial: "1" } : {}) },
        ...(trial ? { trial_period_days: TRIAL_DAYS } : {}),
      },
      success_url: `${origin}/dashboard?upgraded=1`,
      cancel_url: `${origin}/dashboard`,
    });
    return NextResponse.json({ url: session.url, first_month: couponId !== null, trial });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to start checkout." },
      { status: 500 }
    );
  }
}
