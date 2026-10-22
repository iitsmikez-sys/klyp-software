import type Stripe from "stripe";

export function proPriceMatchesOffer(price: Stripe.Price, cents: number): boolean {
  return price.active && price.type === "recurring" && price.currency === "usd" &&
    price.unit_amount === cents && price.recurring?.interval === "month" &&
    price.recurring.interval_count === 1 && price.recurring.usage_type === "licensed";
}
