import Stripe from "stripe";

/** Pro plan price in cents — used when STRIPE_PRICE_PRO isn't set. */
export const PRO_PRICE_CENTS = 2800;

let client: Stripe | null = null;

/** Lazy Stripe client — throws a clear error if the key is missing. */
export function getStripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is not set. Add it to .env.local (Stripe Dashboard → Developers → API keys).");
  }
  if (!client) client = new Stripe(process.env.STRIPE_SECRET_KEY);
  return client;
}
