/** Signed unsubscribe links for the activation emails: the link carries the account id and a code only we can make. */
import { createHmac, timingSafeEqual } from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUserId = (value: string | null | undefined): value is string => !!value && UUID.test(value);

export function signUnsubscribe(userId: string, secret: string): string {
  return createHmac("sha256", secret).update(`activation-unsubscribe:${userId.toLowerCase()}`).digest("hex").slice(0, 32);
}

export function verifyUnsubscribe(userId: string | null | undefined, token: string | null | undefined, secret: string | undefined): boolean {
  if (!secret || !isUserId(userId) || !token) return false;
  const expected = Buffer.from(signUnsubscribe(userId, secret));
  const given = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function unsubscribeUrl(siteUrl: string, userId: string, secret: string): string {
  const base = siteUrl.replace(/\/+$/, "");
  return `${base}/api/activation-unsubscribe?u=${encodeURIComponent(userId)}&t=${signUnsubscribe(userId, secret)}`;
}
