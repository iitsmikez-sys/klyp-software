/**
 * Who gets an activation email, and when. Pure rules (no database, no email service) so they can be tested.
 *
 * Email 1 goes out about 10 minutes after signup and email 2 at 24 hours, but only while the account has not run
 * a video. The windows below stop a long outage from emailing people who signed up hours or days ago.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const FIRST_AFTER_MS = 10 * MINUTE;
export const FIRST_UNTIL_MS = 6 * HOUR;
export const SECOND_AFTER_MS = 24 * HOUR;
export const SECOND_UNTIL_MS = 72 * HOUR;

export type ActivationKind = "first" | "second";

export type ActivationProfile = {
  created_at: string;
  activation_email_1_at: string | null;
  activation_email_2_at: string | null;
  activation_emails_off: boolean;
};

export type DueInput = { profile: ActivationProfile; ranVideo: boolean; now: number };

/** Which email (if any) this account is due for right now. */
export function dueKind({ profile, ranVideo, now }: DueInput): ActivationKind | null {
  if (ranVideo || profile.activation_emails_off) return null;
  const age = now - Date.parse(profile.created_at);
  if (!Number.isFinite(age)) return null;
  if (!profile.activation_email_1_at) {
    return age >= FIRST_AFTER_MS && age <= FIRST_UNTIL_MS ? "first" : null;
  }
  if (!profile.activation_email_2_at) {
    return age >= SECOND_AFTER_MS && age <= SECOND_UNTIL_MS ? "second" : null;
  }
  return null;
}

/** Test and throwaway addresses are never emailed. */
const BLOCKED_DOMAINS = ["klyp.world", "example.com", "example.org", "example.net", "playfine.com", "mailinator.com", "yopmail.com", "guerrillamail.com", "10minutemail.com", "tempmail.com"];

export function isEmailable(email: string | null | undefined): email is string {
  if (!email) return false;
  const at = email.lastIndexOf("@");
  if (at < 1 || at === email.length - 1) return false;
  const domain = email.slice(at + 1).toLowerCase();
  return !BLOCKED_DOMAINS.some((blocked) => domain === blocked || domain.endsWith(`.${blocked}`));
}
