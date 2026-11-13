/**
 * The Pro 4-day pass: a card is required, $3 is charged at checkout, the person gets 250 Sparks and full Pro for 4 days, and then the
 * card is charged the normal $28 a month (with the full 500 Sparks) unless they cancel first. The $3 is not refunded.
 * It is OFF unless PRO_TRIAL=on. When on, it is offered to every new person who has never subscribed, EXCEPT people who arrived from the
 * ad link: they are offered the $17 first month instead (lib/first-month-offer.ts), so nobody sees both. One pass per account, per real
 * email, and per card (see lib/trial-uses.ts). No imports from the checkout code on purpose: the pages, the routes and the webhook all
 * read it.
 */
export const TRIAL_DAYS = 4;
export const TRIAL_SPARKS = 250;
/** What the pass costs today, in cents. The checkout charges exactly this, and the webhook recognises the first invoice by it. */
export const TRIAL_PRICE_CENTS = 300;

export type TrialMode = "off" | "on";

export function trialMode(env: Record<string, string | undefined> = process.env): TrialMode {
  return (env.PRO_TRIAL ?? "").trim().toLowerCase() === "on" ? "on" : "off";
}

type TrialProfile = { tier?: string | null; stripe_customer_id?: string | null; stripe_subscription_id?: string | null; complimentary_pro?: boolean } | null | undefined;

/** Never subscribed or bought anything with Klyp, and not already Pro. */
function isNewPerson(profile: TrialProfile): boolean {
  if (!profile) return false;
  if (profile.tier === "pro" || profile.complimentary_pro) return false;
  return !profile.stripe_customer_id && !profile.stripe_subscription_id;
}

/** Is this person offered the pass? (The email and card checks happen later, in checkout and the webhook.) */
export function proTrialOffered(profile: TrialProfile, mode: TrialMode, hasOfferLink: boolean): boolean {
  if (mode !== "on") return false;
  if (hasOfferLink) return false; // ad-link visitors get the $17 first month instead
  return isNewPerson(profile);
}

/**
 * One real person, one email: lower case, and for Gmail the dots and the "+tag" do not make a new address (a.b+x@gmail.com is
 * ab@gmail.com); for every other provider the "+tag" is ignored. googlemail.com is gmail.com.
 */
export function normalizeEmail(email: string | null | undefined): string {
  const text = (email ?? "").trim().toLowerCase();
  const at = text.lastIndexOf("@");
  if (at < 1) return text;
  let local = text.slice(0, at);
  let domain = text.slice(at + 1);
  if (domain === "googlemail.com") domain = "gmail.com";
  const plus = local.indexOf("+");
  if (plus > 0) local = local.slice(0, plus);
  if (domain === "gmail.com") local = local.split(".").join("");
  return `${local}@${domain}`;
}

/** The keys that mark a pass as used. They are stored once the pass really starts, not when checkout opens. */
export const emailTrialKey = (email: string | null | undefined) => `email:${normalizeEmail(email)}`;
export const cardTrialKey = (fingerprint: string) => `card:${fingerprint}`;
