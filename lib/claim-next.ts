/**
 * The email's "Claim $17" button goes to /claim. If the person is signed out, they sign in first and
 * then come back to /claim. This file says which return paths are allowed (only /claim, so nobody can use
 * the login page to bounce people to another site). No imports on purpose.
 */
export const CLAIM_NEXT_COOKIE = "klyp_next";
export const CLAIM_NEXT_PATTERN = /^\/claim(\?[A-Za-z0-9=&._%-]{0,200})?$/;

/** The path if it is a safe /claim path, otherwise null. */
export function safeClaimNext(value: string | null | undefined): string | null {
  return typeof value === "string" && CLAIM_NEXT_PATTERN.test(value) ? value : null;
}

/** Where the sign-in callback may send someone afterwards: /claim, or the new-password page after a reset email. */
export const AFTER_AUTH_PATTERN = /^\/(claim(\?[A-Za-z0-9=&._%-]{0,200})?|reset-password)$/;
export const RESET_PATH = "/reset-password";
/** Remembers which /claim page to go back to after a password reset. */
export const CLAIM_AFTER_RESET_COOKIE = "klyp_claim";
