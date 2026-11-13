/**
 * Signup guards for the free plan's 60 Sparks. Throwaway email services cannot sign up; the same real address (Gmail dots and "+tags"
 * ignored) cannot sign up twice. The database enforces both for every signup path (supabase/migrations/052_signup_guards.sql); this
 * list is also checked on the login page so the person gets a clear message before anything is sent. The list here and the
 * one in the migration must match (a test keeps them equal). No imports on purpose: the login page loads it.
 */
export const BLOCKED_EMAIL_DOMAINS = [
  "mailinator.com", "yopmail.com", "yopmail.fr", "guerrillamail.com", "guerrillamail.net", "guerrillamail.org", "guerrillamail.biz",
  "sharklasers.com", "grr.la", "10minutemail.com", "10minutemail.net", "tempmail.com", "temp-mail.org", "temp-mail.io", "tempmailo.com",
  "throwawaymail.com", "trashmail.com", "trashmail.net", "getnada.com", "nada.email", "dispostable.com", "maildrop.cc", "mohmal.com",
  "emailkeep.com", "hidingpost.com", "playfine.com", "fakeinbox.com", "mailnesia.com", "moakt.com", "mytemp.email",
  "mintemail.com", "tempinbox.com", "burnermail.io", "inboxkitten.com", "emailondeck.com",
] as const;

export const BLOCKED_SIGNUP_MESSAGE = "Please use a real email address. Temporary email services can't be used to sign up.";
export const DUPLICATE_SIGNUP_MESSAGE = "That email can't be used to sign up. If you already have an account, sign in instead.";

export function emailDomain(email: string): string {
  const text = email.trim().toLowerCase();
  const at = text.lastIndexOf("@");
  return at < 0 ? "" : text.slice(at + 1);
}

export function isBlockedEmailDomain(email: string): boolean {
  const domain = emailDomain(email);
  return (BLOCKED_EMAIL_DOMAINS as readonly string[]).includes(domain);
}

/** What the database says when its guard refuses a signup (Supabase wraps it as a generic "Database error saving new user"). */
export function isGuardRefusal(message: string | null | undefined): boolean {
  return /database error saving new user|blocked_email_domain|duplicate_email/i.test(message ?? "");
}
