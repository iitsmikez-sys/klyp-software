/** Check a configured Stripe Price against the public Pro offer (monthly by default, or yearly). */
export function validateProPrice(
  price: { active: boolean; unit_amount: number | null; currency: string;
    recurring: { interval: string } | null },
  advertisedCents: number,
  interval: "month" | "year" = "month",
): boolean {
  return price.active && price.unit_amount === advertisedCents &&
    price.currency === "usd" && price.recurring?.interval === interval;
}
