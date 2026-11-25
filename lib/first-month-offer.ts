/**
 * First-month offer: a new monthly Pro subscriber pays $17 for the first month, then the normal $28.
 * Stripe does it with one fixed "once" coupon ($11 off) on the first invoice. Only someone who has
 * never had a Stripe customer or subscription with Klyp qualifies, so cancelling and coming back
 * pays the full price. It is only offered to people who came from the ad link (a saved cookie, see
 * lib/offer-cookie.ts). FIRST_MONTH_OFFER=off stops it for everyone and FIRST_MONTH_OFFER=all opens it to
 * every new subscriber, both without a code change.
 */
import { PRO_PRICE_CENTS } from "./stripe.ts";

export const FIRST_MONTH_PRICE_CENTS = 1700;
export const FIRST_MONTH_COUPON_ID = "klyp-first-month-17";
export const FIRST_MONTH_DISCOUNT_CENTS = PRO_PRICE_CENTS - FIRST_MONTH_PRICE_CENTS;
/** The Black Friday price: half off the first month. It has its own fixed coupon, made on first use like the $17 one. */
export const BLACK_FRIDAY_PRICE_CENTS = 1400;
export const BLACK_FRIDAY_COUPON_ID = "klyp-first-month-14";

/** The coupon for a first-month price in cents (1400 or 1700); anything else gets the everyday $17 one. */
export function firstMonthCouponFor(priceCents: number): { id: string; priceCents: number; discountCents: number } {
  const cents = priceCents === BLACK_FRIDAY_PRICE_CENTS ? BLACK_FRIDAY_PRICE_CENTS : FIRST_MONTH_PRICE_CENTS;
  return { id: cents === BLACK_FRIDAY_PRICE_CENTS ? BLACK_FRIDAY_COUPON_ID : FIRST_MONTH_COUPON_ID, priceCents: cents, discountCents: PRO_PRICE_CENTS - cents };
}

type OfferProfile = { tier?: string | null; stripe_customer_id?: string | null; stripe_subscription_id?: string | null; complimentary_pro?: boolean } | null | undefined;

/** Never subscribed or bought anything with Klyp, and not already Pro: the people a first-month discount is for. */
export function isNewCustomer(profile: OfferProfile): boolean {
  if (!profile) return false;
  if (profile.tier === "pro" || profile.complimentary_pro) return false;
  return !profile.stripe_customer_id && !profile.stripe_subscription_id;
}

export function firstMonthOfferAvailable(
  profile: OfferProfile, env: Record<string, string | undefined> = process.env, hasOfferLink = false,
): boolean {
  if (!profile) return false;
  const mode = (env.FIRST_MONTH_OFFER ?? "").trim().toLowerCase();
  if (mode === "off") return false;
  if (mode !== "all" && !hasOfferLink) return false;
  return isNewCustomer(profile);
}

type CouponStripe = {
  coupons: {
    retrieve(id: string): Promise<{ amount_off?: number | null; currency?: string | null; duration?: string }>;
    create(params: Record<string, unknown>): Promise<unknown>;
  };
};

/** The one fixed coupon: created on first use, reused after. A same-id coupon with other terms is an error. */
export async function ensureFirstMonthCoupon(stripe: CouponStripe, priceCents: number = FIRST_MONTH_PRICE_CENTS): Promise<string> {
  const want = firstMonthCouponFor(priceCents);
  try {
    const c = await stripe.coupons.retrieve(want.id);
    if (c.amount_off !== want.discountCents || c.currency !== "usd" || c.duration !== "once") {
      throw new Error(`The first-month coupon in Stripe does not match $${want.priceCents / 100}. Please contact support.`);
    }
  } catch (err) {
    const code = (err as { code?: string; statusCode?: number } | null);
    if (code?.code !== "resource_missing" && code?.statusCode !== 404) throw err;
    await stripe.coupons.create({
      id: want.id, amount_off: want.discountCents, currency: "usd", duration: "once",
      name: `Klyp: first month $${want.priceCents / 100}`,
    });
  }
  return want.id;
}
