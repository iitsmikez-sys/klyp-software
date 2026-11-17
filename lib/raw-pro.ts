/**
 * Raw downloads are the clean cut with no Klyp watermark, so they are a Pro feature: Free exports always
 * carry the watermark. The wording lives here so the screen and the server say the same thing.
 */
export const RAW_PRO_TITLE = "Raw clips are for Pro";
export const RAW_PRO_BODY =
  "Raw gives you the clean cut with no watermark, so you can edit it in CapCut or Premiere. Free clips come with the Klyp watermark.";
/** What the server answers a Free account that asks for a raw download (403). */
export const RAW_PRO_MESSAGE = "Raw downloads are a Pro feature. Free clips come with the Klyp watermark. Upgrade to Pro for clean raw clips.";

/** The cheap way in this person is offered right now (from GET /api/stripe/checkout), or none. */
export type RawOffer =
  | { kind: "trial"; days: number; sparks: number; cents: number }
  | { kind: "first_month"; cents: number }
  | { kind: "none" };

const whole = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;

/** Reads the checkout GET answer. The 4-day pass wins over the first-month price, like on the Upgrade page. Anything odd means "none". */
export function rawOfferFrom(data: unknown): RawOffer {
  const d = (data ?? {}) as { trial?: { days?: unknown; sparks?: unknown; price_cents?: unknown } | null; first_month?: { price_cents?: unknown } | null };
  if (d.trial && whole(d.trial.days) && whole(d.trial.sparks) && whole(d.trial.price_cents)) {
    return { kind: "trial", days: d.trial.days, sparks: d.trial.sparks, cents: d.trial.price_cents };
  }
  if (d.first_month && whole(d.first_month.price_cents)) return { kind: "first_month", cents: d.first_month.price_cents };
  return { kind: "none" };
}

export const dollars = (cents: number): string => `$${cents % 100 === 0 ? cents / 100 : (cents / 100).toFixed(2)}`;

/** The offer box and button wording for the pop-up. The $28 and the cancel rule are always stated. */
export function rawOfferCopy(offer: RawOffer): { heading: string; detail: string; button: string } | null {
  if (offer.kind === "trial") {
    return {
      heading: `${offer.days}-day Pro pass: ${dollars(offer.cents)}`,
      detail: `${offer.sparks} Sparks, no watermark, raw exports. After ${offer.days} days it is $28 a month unless you cancel first.`,
      button: `Start for ${dollars(offer.cents)}`,
    };
  }
  if (offer.kind === "first_month") {
    return {
      heading: `Your first month of Pro: ${dollars(offer.cents)}`,
      detail: "500 Sparks, no watermark, raw exports. After the first month it is $28 a month. Cancel any time.",
      button: `Start for ${dollars(offer.cents)}`,
    };
  }
  return null;
}
