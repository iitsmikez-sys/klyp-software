import Stripe from "stripe";

/** Pro plan price in cents — used when STRIPE_PRICE_PRO isn't set. */
export const PRO_PRICE_CENTS = 2800;

/** Yearly Pro: $276 billed once a year ($23 x 12, 18% less than 12 monthly payments). */
export const PRO_YEARLY_PRICE_CENTS = 27600;
export type BillingInterval = "month" | "year";

let client: Stripe | null = null;

/** Lazy Stripe client — throws a clear error if the key is missing. */
export function getStripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is not set. Add it to .env.local (Stripe Dashboard → Developers → API keys).");
  }
  if (!client) client = new Stripe(process.env.STRIPE_SECRET_KEY);
  return client;
}
