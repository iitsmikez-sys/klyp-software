/**
 * The Pro free trial: 4 days, a card is required, and the person gets 250 Sparks during it (the full 500 arrive with the first real
 * payment). It is OFF unless PRO_TRIAL is set:
 *   PRO_TRIAL=ads  only people who arrived from the ad link (the same saved cookie as the $17 first month) are offered it
 *   PRO_TRIAL=on   every new person who has never subscribed is offered it
 * Anything else, or nothing, means nobody is offered it. One trial per account, per real email address, and per card (see
 * lib/trial-uses.ts). No imports from the checkout code on purpose: the pages, the routes and the webhook all read it.
 */
export const TRIAL_DAYS = 4;
export const TRIAL_SPARKS = 250;

export type TrialMode = "off" | "ads" | "on";

export function trialMode(env: Record<string, string | undefined> = process.env): TrialMode {
  const value = (env.PRO_TRIAL ?? "").trim().toLowerCase();
  return value === "on" || value === "ads" ? value : "off";
}

type TrialProfile = { tier?: string | null; stripe_customer_id?: string | null; stripe_subscription_id?: string | null; complimentary_pro?: boolean } | null | undefined;

/** Never subscribed or bought anything with Klyp, and not already Pro. */
function isNewPerson(profile: TrialProfile): boolean {
  if (!profile) return false;
  if (profile.tier === "pro" || profile.complimentary_pro) return false;
  return !profile.stripe_customer_id && !profile.stripe_subscription_id;
}

/** Is this person offered the trial? (The email and card checks happen later, in checkout and the webhook.) */
export function proTrialOffered(profile: TrialProfile, mode: TrialMode, hasOfferLink: boolean): boolean {
  if (mode === "off") return false;
  if (mode === "ads" && !hasOfferLink) return false;
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

/** The keys that mark a trial as used. They are stored once a trial really starts, not when checkout opens. */
export const emailTrialKey = (email: string | null | undefined) => `email:${normalizeEmail(email)}`;
export const cardTrialKey = (fingerprint: string) => `card:${fingerprint}`;
