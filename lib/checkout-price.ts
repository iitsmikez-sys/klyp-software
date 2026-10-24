/** Check a configured Stripe Price against the public monthly Pro offer. */
export function validateProPrice(
  price: { active: boolean; unit_amount: number | null; currency: string;
    recurring: { interval: string } | null },
  advertisedCents: number,
): boolean {
  return price.active && price.unit_amount === advertisedCents &&
    price.currency === "usd" && price.recurring?.interval === "month";
}
